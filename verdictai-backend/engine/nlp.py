from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import pandas as pd
import logging
from engine.model import get_feature_names

logger = logging.getLogger(__name__)

MITIGATION_CORPUS = {
  "employment_gap": [
    "I was on medical leave due to illness",
    "I took maternity or paternity leave",
    "I was laid off due to company restructuring or downsizing",
    "I was a caregiver for a family member",
    "I was pursuing education or professional certification",
    "I had a planned sabbatical between positions",
    "I was dealing with a family emergency",
  ],
  "income_instability": [
    "I am a freelancer with variable but consistent income",
    "I have side income from investments or rental property",
    "I recently received a salary increase or promotion",
    "My income includes bonuses and commissions",
    "I have documented proof of income stability",
  ],
  "high_delinquencies": [
    "I had a medical emergency that caused financial hardship",
    "My late payments were due to a banking error",
    "I have since cleared all outstanding dues",
    "The delinquencies were during a period of unemployment now resolved",
    "I have documentation showing disputed charges",
  ],
  "high_utilization": [
    "I am actively paying down my credit card balance",
    "The high utilization was temporary during a major purchase",
    "My utilization has since decreased significantly",
    "I consolidated my debt to improve my credit profile",
  ],
  "high_debt_ratio": [
    "I have a significant asset base that offsets my debt",
    "My debt is primarily a mortgage on appreciating property",
    "I am on a structured debt repayment plan",
    "My debt ratio will decrease significantly after an upcoming payment",
  ]
}

# The mapped fields from 'flagged_factors' matching our SHAP explainers to concepts
FACTOR_BINS = {
    "NumberOfTime30-59DaysPastDueNotWorse": "employment_gap",
    "MonthlyIncome": "income_instability",
    "income_per_dependent": "income_instability",
    "NumberOfTimes90DaysLate": "high_delinquencies",
    "total_delinquencies": "high_delinquencies",
    "RevolvingUtilizationOfUnsecuredLines": "high_utilization",
    "credit_utilization_risk": "high_utilization",
    "DebtRatio": "high_debt_ratio",
    # Human Name Mapping (from explainer.py)
    "Credit Utilization": "high_utilization",
    "Monthly Income": "income_instability",
    "Debt-to-Income Ratio": "high_debt_ratio",
    "Payment History": "high_delinquencies",
    "Recent Delinquencies": "employment_gap",
    "Total Delinquency Score": "high_delinquencies"
}

_vectorizer = None

def get_vectorizer():
    global _vectorizer
    if _vectorizer is None:
        logger.info("Initializing Light-Weight TF-IDF Vectorizer...")
        # We use a simple vectorizer that works well for short-text similarity
        _vectorizer = TfidfVectorizer(stop_words='english', lowercase=True)
    return _vectorizer

# Meaningful financial keywords required for valid evidence
_FINANCIAL_KEYWORDS = [
    "medical", "emergency", "hospital", "surgery", "illness", "diagnosis",
    "error", "dispute", "incorrect", "administrative", "banking", "bank",
    "cleared", "settled", "resolved", "paid", "payment", "proof", "document",
    "letter", "statement", "record", "certificate", "income", "salary", "employment",
    "laid off", "terminated", "unemployed", "maternity", "paternity", "leave",
    "freelance", "self-employed", "contract", "promotion", "raise",
    "utilization", "credit", "debt", "loan", "mortgage", "invested",
    "delinquency", "late", "missed", "overdue", "bureau", "verified",
    "caregiving", "caregiver", "family", "dependent"
]

def _passes_quality_gate(text: str) -> tuple[bool, str]:
    """Pre-screen evidence text for minimum quality before NLP scoring."""
    words = text.strip().split()
    
    # 1. Minimum length: at least 15 meaningful words
    if len(words) < 15:
        return False, f"Evidence too brief ({len(words)} words). Please provide at least 15 words of context explaining your situation."
    
    # 2. Check for meaningful financial vocabulary
    text_lower = text.lower()
    keyword_hits = [kw for kw in _FINANCIAL_KEYWORDS if kw in text_lower]
    if len(keyword_hits) < 2:
        return False, "Evidence lacks specific financial context. Please mention specific details such as the nature of the error, documents you have, or actions taken."
    
    # 3. Reject obvious gibberish / repeated characters
    unique_words = set(w.lower().strip('.,!?') for w in words)
    if len(unique_words) < 8:
        return False, "Evidence contains insufficient unique information. Please provide a detailed explanation."
    
    return True, "ok"

def process_appeal(appeal_texts: list[str], flagged_factors: list[str]) -> list:
    """
    Evaluates evidence using TF-IDF Vectorization with a multi-layer quality gate.
    Returns: [{ factor, mitigation_type: "full"|"partial"|"none", 
                similarity_score, matched_concept, reduction_factor }]
    """
    vectorizer = get_vectorizer()
    
    # Pre-screen all appeal texts — reject low quality inputs
    screened_texts = []
    for text in appeal_texts:
        passed, reason = _passes_quality_gate(text)
        if passed:
            screened_texts.append(text)
        else:
            logger.warning(f"Evidence rejected by quality gate: {reason} | Text: '{text[:60]}...'")
    
    if not screened_texts:
        logger.warning("All evidence texts failed quality gate. No mitigations will be applied.")
        return []
    
    mitigations = []
    
    for factor in flagged_factors:
        concept = FACTOR_BINS.get(factor)
        if not concept:
            continue
            
        corpus = MITIGATION_CORPUS[concept]
        
        # Build a temporary matrix to compare appeal texts against corpus
        # We combine them so the TF-IDF vocabulary covers both
        all_docs = corpus + screened_texts
        tfidf_matrix = vectorizer.fit_transform(all_docs)
        
        # Separate the matrix
        corpus_vectors = tfidf_matrix[:len(corpus)]
        appeal_vectors = tfidf_matrix[len(corpus):]
        
        # Compute cosine similarity between every appeal and every corpus item
        sim_matrix = cosine_similarity(appeal_vectors, corpus_vectors)
        
        max_sim = np.max(sim_matrix)
        best_match_idx = np.unravel_index(np.argmax(sim_matrix), sim_matrix.shape)[1]
        best_match = corpus[best_match_idx]
        
        logger.info(f"Factor '{factor}' → concept '{concept}' → max_sim={max_sim:.3f}")
                    
        m_type = "none"
        reduction = 0.0
        
        # RAISED THRESHOLDS: prevents vague text from gaming the system
        if max_sim > 0.60:      # Strong evidence → full mitigation
            m_type = "full"
            reduction = 0.75   # Conservative: only reduce by 75%, not wipe entirely
        elif max_sim > 0.45:    # Moderate evidence → partial mitigation
            m_type = "partial"
            reduction = 0.35   # Partial: only 35% reduction, not enough to flip marginal cases
            
        if m_type != "none":
            mitigations.append({
                "factor_concept": concept,
                "mitigation_type": m_type,
                "similarity_score": float(max_sim),
                "matched_concept": best_match,
                "reduction_factor": reduction,
                "factor_name": factor
            })
            
    return mitigations

def recalculate_with_mitigations(feature_vector: dict, mitigations: list, model) -> dict:
    new_fv = feature_vector.copy()
    
    for m in mitigations:
        concept = m["factor_concept"]
        rf = m["reduction_factor"]
        
        # apply reduction factor according to concepts
        if concept == "employment_gap":
            new_fv["NumberOfTime30-59DaysPastDueNotWorse"] *= (1.0 - rf)
            new_fv["total_delinquencies"] *= (1.0 - rf)
        elif concept == "high_delinquencies":
            # If 90 days late is cleared, it significantly fixes the profile
            new_fv["NumberOfTimes90DaysLate"] = 0.0
            new_fv["total_delinquencies"] = 0.0
            # Also reset stability which depends on total_delinquencies
            new_fv["employment_stability_score"] = float(new_fv.get("age", 35) / 10.0) 
        elif concept == "income_instability":
            # increase MonthlyIncome by 25% for documented stability
            bump = 0.25 if rf > 0.5 else 0.125
            new_fv["MonthlyIncome"] *= (1.0 + bump)
        elif concept == "high_utilization": 
            # Aggressive utilization reset
            new_fv["RevolvingUtilizationOfUnsecuredLines"] = 0.10 # Target healthy range
            new_fv["credit_utilization_risk"] = 0.02
        elif concept == "high_debt_ratio":
            new_fv["DebtRatio"] *= (1.0 - rf)
            new_fv["credit_utilization_risk"] *= (1.0 - rf)
            
    df = pd.DataFrame([new_fv], columns=get_feature_names())
    proba = model.predict_proba(df)[0, 1]
    decision = "DENY" if proba > 0.35 else "APPROVE"
    confidence = float(proba * 100) if decision == "DENY" else float((1 - proba) * 100)
    
    return {
        "new_decision": decision,
        "new_confidence": round(confidence, 2),
        "raw_probability": float(proba),
        "new_feature_vector": df.iloc[0].to_dict()
    }

def score_evidence_strength(text: str) -> dict:
    words = text.split()
    total_words = len(words)
    
    # length score
    length_score = min(total_words / 50.0, 1.0) * 25
    
    # Specificity Score
    # numbers -> any digits
    numbers_count = sum(1 for w in words if any(c.isdigit() for c in w))
    specificity_score = min((numbers_count / max(total_words, 1)) * 10.0, 1.0) * 25
    
    # Coverage theme (naive keyword search across our concepts)
    coverage = 0
    l_text = text.lower()
    themes = [
        ["medical", "hospital", "illness", "health", "leave"],
        ["laid off", "lost job", "restructuring", "unemployed"],
        ["freelance", "contract", "bonus", "commission"],
        ["error", "dispute", "mistake"],
        ["asset", "mortgage", "property", "investment", "pay down", "paid off"]
    ]
    for th in themes:
        if any(kw in l_text for kw in th):
            coverage += 1
    coverage_score = min(coverage / 3.0, 1.0) * 30
    
    # Sentiment confidence
    assertive_words = ["document", "proof", "record", "show", "verify", "clear", "attached"]
    confidence_pts = 20 if any(cw in l_text for cw in assertive_words) else 0
    
    total = length_score + specificity_score + coverage_score + confidence_pts
    return {
        "score": int(min(total, 100)),
        "breakdown": {
            "length": int(length_score),
            "specificity": int(specificity_score),
            "coverage": int(coverage_score),
            "confidence": confidence_pts
        }
    }

def detect_tone(text: str) -> str:
    l_text = text.lower()
    
    distressed = ["desperate", "please", "unfair", "destroyed", "ruined", "begging", "cant afford", "can't afford", "losing", "scared"]
    angry = ["unacceptable", "ridiculous", "demand", "disgusting", "outrageous", "discrimination"]
    confident = ["documentation", "evidence", "prove", "clearly", "demonstrate", "records show", "verifiable"]
    confused = ["dont understand", "don't understand", "why", "confused", "makes no sense", "unclear", "what does"]
    
    if any(w in l_text for w in distressed): return "distressed"
    if any(w in l_text for w in angry): return "angry"
    if any(w in l_text for w in confident): return "confident"
    if any(w in l_text for w in confused): return "confused"
    
    return "neutral"
