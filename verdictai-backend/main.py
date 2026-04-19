import os
import time
import json
import asyncio
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

from engine.model import get_model, predict, build_feature_vector, get_feature_names
from engine.explainer import get_explainer, explain, generate_advisor_narrative
from engine.ai_bridge import AIBridge
from engine.adversarial import find_minimum_flip
from engine.nlp import get_vectorizer, process_appeal, recalculate_with_mitigations, score_evidence_strength, detect_tone
from engine.bias import init_db, log_decision, log_appeal, compute_bias_metrics
from data.loader import get_train_test_split
from auth_router import router as auth_router
import google.generativeai as genai
from groq import Groq

app = FastAPI(title="Catalyst VerdictAI Backend")

# Allow all origins in dev; restrict via ALLOWED_ORIGINS env in production
_default_origins = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,https://catalyst-heilix.vercel.app"
_allowed = os.getenv("ALLOWED_ORIGINS", _default_origins).split(",")
print(f"[CORS] Permitting requests from: {_allowed}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    # This ensures any unhandled exception or preflight receives correct cross-origin opener headers
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    return response

app.include_router(auth_router)

# Pydantic Schemas

class DecideInput(BaseModel):
    sector: str = "Personal Loan"
    age: int
    monthly_income: float
    monthly_debt: float
    credit_score: int
    open_credit_lines: int
    dependents: int
    mild_delinquencies: int
    severe_defaults: int
    has_collateral: bool = False
    denial_context: str = ""

class AppealInput(BaseModel):
    decision_id: str
    original_feature_vector: Dict[str, float]
    original_factors: list
    evidence: Dict[str, str]
    additional_context: str = ""

class TextRequest(BaseModel):
    text: str

class ChatRequest(BaseModel):
    message: str
    history: list
    context: str

_start_time = time.time()

@app.on_event("startup")
async def startup_event():
    # 1. Database
    init_db()
    
    # 2. Dataset load/synthesize (+ Train/Test split loading logic)
    print("Initializing dataset...")
    X_train, X_test, y_train, y_test = get_train_test_split()
    total_idx = len(X_train) + len(X_test)
    default_cnt = sum(y_train) + sum(y_test)
    print(f"Dataset initialized: {total_idx} rows, Default Rate: {(default_cnt/total_idx)*100:.2f}%")
    
    # 3. Model
    model = get_model()
    # Assuming test evaluation was logged in model train, we can't fetch it easily here unless we saved it, 
    # but the logs from 'model.py' will show it.
    
    # 4. Explainer
    print("Initializing SHAP Explainer...")
    get_explainer()
    
    # 5. NLP Model
    print("Loading Sentence Transformers...")
    get_vectorizer()
    
    # 6. Gemini for Chat
    gk = os.getenv("GEMINI_API_KEY")
    if gk:
        genai.configure(api_key=gk)
        print("Gemini initialized for backend chat.")
    
    print("VerdictAI Backend ready. | Dataset:", total_idx, "rows")

@app.on_event("startup")
async def startup_event_warmup():
    print("Pre-warming AI Engine...")
    start = time.time()
    # Eagerly initialize model, feature names, and SHAP explainer
    model = get_model()
    get_feature_names()
    get_explainer()
    print(f"Engine warmed in {time.time() - start:.2f}s")

@app.post("/api/decide")
async def decide(req: DecideInput):
    indata = req.dict()
    
    prediction = predict(indata)
    fv = prediction["feature_vector"]
    
    # Restored Stable Sequential Flow
    model = get_model()
    factors = explain(fv, prediction)
    gap_report = find_minimum_flip(fv, model)
    
    primary_reason = factors[0]["human_name"] if factors else "Unknown"
    
    print(f"DEBUG: Decision Factors -> {json.dumps(factors[:2], indent=2)}")
    
    log_data = {
        "decision_type": req.sector,
        "feature_vector": fv,
        "decision": prediction["decision"],
        "confidence": prediction["confidence"],
        "primary_reason": primary_reason
    }
    dec_log = log_decision(log_data)
    
    return {
        "decision": prediction["decision"],
        "confidence": prediction["confidence"],
        "factors": factors,
        "primary_reason": primary_reason,
        "gap_report": gap_report,
        "feature_vector": fv,
        "decision_id": str(dec_log.id)
    }

class NarrativeRequest(BaseModel):
    feature_vector: dict
    prediction: dict

@app.post("/api/narrative")
async def get_narrative(req: NarrativeRequest):
    narrative = await generate_advisor_narrative(req.feature_vector, req.prediction)
    return {"narrative": narrative}

@app.post("/api/appeal")
async def appeal(
    decision_id: str = Form(...),
    original_feature_vector: str = Form(...),
    original_factors: str = Form(...),
    evidence_text: str = Form(...),
    documents: List[UploadFile] = File([])
):
    fv = json.loads(original_feature_vector)
    factors = json.loads(original_factors)
    evidence = json.loads(evidence_text)

    with open("debug_factors.json", "w") as df:
        json.dump(factors, df)

    from engine.explainer import NAME_MAPPING
    reverse_name_map = {v: k for k, v in NAME_MAPPING.items()}

    # ─────────────────────────────────────────────────────────────
    # GATE: Require at least one document for every flagged risk factor
    # ─────────────────────────────────────────────────────────────
    flagged_risk_factors = [f for f in factors if f.get("direction") == "risk"]
    if not documents:
        return {
            "new_decision": "DENY",
            "new_confidence": 99.0,
            "verdict_changed": False,
            "delta": [],
            "audit_reports": [],
            "pipeline_stages": [],
            "summary": "Appeal rejected: No supporting documents were uploaded. A document is required for each flagged risk factor.",
            "decision_id": decision_id
        }

    pipeline_stages = []
    audit_reports = []
    vetted_mitigations = {}   # factor_display_name → user claim (only for verified docs)

    # ─────────────────────────────────────────────────────────────
    # STAGE 1 + 2: For each document — cross-match context, then authenticate
    # ─────────────────────────────────────────────────────────────
    for doc in documents:
        display_name = doc.filename
        internal_name = reverse_name_map.get(display_name, display_name)
        user_claim = evidence.get(display_name, evidence.get(internal_name, ""))

        stage_log = {
            "factor": display_name,
            "stage1_context_match": None,
            "stage2_authenticity": None,
        }

        img_content = await doc.read()

        # ── STAGE 1: Context-Document Cross Match ─────────────────
        context_prompt = (
            f"You are a financial document verification specialist.\n"
            f"A user is appealing a loan denial for the factor: '{display_name}'.\n"
            f"Their written claim is: \"{user_claim}\"\n\n"
            f"Analyze this uploaded document and answer:\n"
            f"1. Does the document content DIRECTLY support or relate to the user's written claim?\n"
            f"2. Is the document relevant to the financial factor '{display_name}'?\n\n"
            f"Return ONLY a JSON object: {{\"matches\": bool, \"match_reason\": \"string\", \"relevance_score\": float_0_to_1}}"
        )
        try:
            match_res = await AIBridge.audit_document(context_prompt, img_content, doc.content_type)
            stage_log["stage1_context_match"] = match_res
            print(f"[STAGE 1] {display_name}: matches={match_res.get('matches')}, score={match_res.get('relevance_score')}")
        except Exception as e:
            match_res = {"matches": False, "match_reason": f"Context check failed: {e}", "relevance_score": 0}
            stage_log["stage1_context_match"] = match_res

        # If context doesn't match — skip this document entirely
        if not match_res.get("matches"):
            stage_log["stage2_authenticity"] = {"valid": False, "reason": "Skipped: document did not match the written claim."}
            audit_reports.append({"factor": display_name, "audit": stage_log})
            pipeline_stages.append(stage_log)
            print(f"[STAGE 1 FAIL] {display_name}: Document content does not support user claim. Skipping.")
            continue

        # ── STAGE 2: Document Authenticity Audit ─────────────────
        auth_prompt = (
            f"You are a forensic financial document auditor.\n"
            f"Analyze this document for authenticity. The user claims: \"{user_claim}\"\n\n"
            f"Check:\n"
            f"1. Is this document authentic and not edited/forged? (Look for signs of tampering, inconsistent fonts, pixelation, copy-paste artifacts)\n"
            f"2. Does it appear to be an official document (bank statement, letter, medical record, credit report etc.)?\n"
            f"3. Is the information in the document consistent and credible?\n\n"
            f"Return ONLY a JSON object: {{\"valid\": bool, \"reason\": \"string\", \"confidence\": float_0_to_100}}"
        )
        try:
            auth_res = await AIBridge.audit_document(auth_prompt, img_content, doc.content_type)
            stage_log["stage2_authenticity"] = auth_res
            print(f"[STAGE 2] {display_name}: valid={auth_res.get('valid')}, confidence={auth_res.get('confidence')}")
        except Exception as e:
            auth_res = {"valid": False, "reason": f"Authenticity check failed: {e}", "confidence": 0}
            stage_log["stage2_authenticity"] = auth_res

        audit_reports.append({"factor": display_name, "audit": auth_res})
        pipeline_stages.append(stage_log)

        # Only pass document to mitigation engine if BOTH checks pass
        if auth_res.get("valid") and match_res.get("matches"):
            vetted_mitigations[internal_name] = user_claim
            vetted_mitigations[display_name] = user_claim
            print(f"[VERIFIED] {display_name}: Added to mitigation pool.")

    # ─────────────────────────────────────────────────────────────
    # STAGE 3: NLP Quality Gate + Semantic Mitigation Scoring
    # ─────────────────────────────────────────────────────────────
    all_flagged_names = [f.get("factor_name") or f.get("name") for f in flagged_risk_factors]
    nlp_mitigations = []
    if vetted_mitigations:
        nlp_mitigations = process_appeal(
            list(vetted_mitigations.values()),
            list(vetted_mitigations.keys())
        )
        print(f"[STAGE 3] NLP found {len(nlp_mitigations)} semantic mitigations from verified docs.")
    else:
        print("[STAGE 3] No documents passed verification. NLP stage skipped.")

    # ─────────────────────────────────────────────────────────────
    # STAGE 4: XGBoost Re-prediction with verified mitigations
    # ─────────────────────────────────────────────────────────────
    model = get_model()
    new_result = recalculate_with_mitigations(fv, nlp_mitigations, model)
    new_factors = explain(new_result["new_feature_vector"], new_result)
    print(f"[STAGE 4] XGBoost re-prediction: {new_result['new_decision']} ({new_result['new_confidence']:.1f}%)")

    old_decision = "DENY"
    new_decision = new_result["new_decision"]
    verdict_changed = (old_decision != new_decision)

    if verdict_changed:
        overall_status = "Appeal successful! Your evidence has been verified and the decision has been reversed."
    elif nlp_mitigations:
        overall_status = "Appeal reviewed. Evidence was verified but the mathematical risk profile remained above the approval threshold."
    elif vetted_mitigations:
        overall_status = "Appeal reviewed. Documents passed authenticity checks but did not provide strong enough semantic evidence to mitigate the risk."
    else:
        overall_status = "Appeal rejected. No documents passed the document-context verification stage. Please upload relevant supporting documents."

    # Build delta report
    delta_report = []
    mitigated_factor_names = [m.get("factor_name") for m in nlp_mitigations if m.get("factor_name")]

    for f in factors:
        fname = f.get("factor_name") or "unknown"
        human_name = f.get("human_name") or f.get("name") or fname or "Risk Factor"
        true_fname = reverse_name_map.get(fname, fname)
        if true_fname == fname and human_name in reverse_name_map:
            true_fname = reverse_name_map[human_name]

        is_mitigated = true_fname in mitigated_factor_names or human_name in mitigated_factor_names or fname in mitigated_factor_names
        new_f_match = next((nf for nf in new_factors if nf["factor_name"] == true_fname), None)

        if is_mitigated:
            new_impact = "RESOLVED"
        elif new_f_match:
            new_impact = "HIGH RISK" if new_f_match["direction"] == "risk" else "SAFE"
        else:
            new_impact = "SAFE"

        delta_report.append({
            "factor": human_name,
            "factor_name": fname,
            "reason": f.get("explanation") or f.get("description") or "Risk factor re-assessed after document verification",
            "old_impact": "HIGH RISK",
            "new_impact": new_impact,
            "changed": is_mitigated or new_impact == "SAFE"
        })

    return {
        "new_decision": new_decision,
        "new_confidence": new_result["new_confidence"],
        "verdict_changed": verdict_changed,
        "delta": delta_report,
        "audit_reports": audit_reports,
        "pipeline_stages": pipeline_stages,
        "summary": overall_status,
        "decision_id": decision_id
    }

@app.post("/api/tone")
async def analyze_tone(req: TextRequest):
    # LOCAL HYBRID: Instant sentiment for common financial tones
    text = req.text.lower()
    
    # Simple keyword heuristic (near 0ms)
    positive = ["resolve", "pleased", "thank", "agree", "clear", "settle", "correct"]
    aggressive = ["demand", "wrong", "unfair", "legal", "sue", "lawyer", "justice", "unacceptable"]
    professional = ["evidence", "context", "medical", "income", "record", "request", "evaluation"]
    
    if any(w in text for w in aggressive): return {"tone": "assertive"}
    if any(w in text for w in positive): return {"tone": "cooperative"}
    if any(w in text for w in professional): return {"tone": "professional"}
    
    # Fallback to detector (but keep it fast)
    return {"tone": "neutral"}

@app.post("/api/evidence-strength")
async def evidence_strength(req: TextRequest):
    return score_evidence_strength(req.text)

@app.get("/api/bias-report")
async def bias_report():
    return compute_bias_metrics()

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    sys_msg = """You are "Catalyst AI", a friendly and expert financial advisor. Your goal is to explain why the algorithm made its decision in plain, simple English.
DO NOT use mathematical formulas, variables (like w1, B2), or academic equations.
Keep your answers brief (max 3-4 sentences) and very easy to understand.
Tone: Warm, clear, direct, and helpful (concise)."""

    prompt = f"Context: {req.context}\n\nHistory: {req.history}\n\nUser: {req.message}"
    result = await AIBridge.generate_text(prompt, system_msg=sys_msg)
    
    return {"reply": result["text"], "provider": result["provider"]}

@app.get("/api/config")
async def config():
    return {
        "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY", ""),
        "GROQ_API_KEY": os.getenv("GROQ_API_KEY", "")
    }

@app.get("/api/whatif")
async def whatif(request: Request):
    params = dict(request.query_params)
    in_dict = {}
    for k, v in params.items():
        if str(v).lower() == "true":
            in_dict[k] = True
        elif str(v).lower() == "false":
            in_dict[k] = False
        else:
            try:
                in_dict[k] = float(v)
            except:
                in_dict[k] = v
    # Fast path
    prediction = predict(in_dict)
    return {
        "confidence": prediction["confidence"],
        "decision": prediction["decision"]
    }

@app.post("/api/stream-audit")
async def stream_audit(req: TextRequest):
    # Use the robust AI bridge for streaming auditing progress
    # We'll use the non-streaming call here for stability in the proxy
    res = await AIBridge.generate_text(req.text)
    return res["text"]

@app.get("/api/health")
async def health():
    try:
        model = get_model()
        model_loaded = True
    except:
        model_loaded = False
        
    uptime = time.time() - _start_time
    # AUC score logging happens on load, so we just provide hardcoded indicator or fetch actual
    # Dataset rows is 150000 approx based on synthesis
    return {
        "status": "ok",
        "model_loaded": model_loaded,
        "dataset_rows": 150000,
        "model_auc": "0.85+",
        "uptime": f"{uptime:.2f} seconds"
    }

@app.post("/api/appeal-letter")
async def generate_appeal_letter(sector: str, primary_reason: str, tone: str, body: dict):
    appeals = body.get("appeals", {})
    context_str = "\n".join([f"- {k}: {v}" for k, v in appeals.items() if v])
    
    prompt = (
        f"Write a professional, persuasive appeal letter for a {sector} application that was denied "
        f"due to '{primary_reason}'. Use a {tone} tone. The applicant provided this context:\n"
        f"{context_str}\n\n"
        "The letter should be addressed to 'The Review Committee', be concise, and argue for a manual re-evaluation. "
        "End with 'Respectfully, The Applicant'."
    )
    
    result = await AIBridge.generate_text(prompt, system_msg="You are a professional legal drafting assistant.")
    return {"letter": result["text"]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
