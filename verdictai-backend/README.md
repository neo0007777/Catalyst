# Catalyst VerdictAI

VerdictAI is the advanced decision-engine backing "Catalyst," an AI-powered algorithmic decision contestation platform. VerdictAI evaluates applicant factors, returns transparent reasonings behind automated decisions, identifies localized bias disparities across applicant cohorts, and allows a completely deterministic "What-if" testing suite to explain its behaviors. Furthermore, it incorporates advanced Natural Language Processing to contextually map contested claims or unstructured textual evidence against predetermined risk-mitigation vectors securely.

## Architecture

```text
    [Frontend/Client]
          │
    (JSON / REST API)
          ▼
   [FastAPI Router]─────────────► [Bias Tracking (SQLite)]
          │                               ▲
          ▼                               │
[Engine Logic Gateways]                   │
          │                               │
    ├─────┴──────┬──────────────┬─────────┘   
    ▼            ▼              ▼                 
 [XGBoost]    [SHAP]   [SentenceTransformers]     
 (Predict)  (Explain)    (NLP processor)
```

## Setup Instructions

1. **Clone & Environment Setup:**
Ensure Python 3.11+ is installed.
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. **Starting the Application:**
```bash
uvicorn main:app --reload
```
On the first startup, it will synthesize the dataset if `cs-training.csv` is not found, train the required XGBoost model, setup SHAP explainers, load the NLP models, and initialize tables.

## Model Training

The central inferencing pipeline relies on XGBoost, calibrated for robust imbalanced classifications:
- **Dataset**: `cs-training.csv` "Give Me Some Credit" dataset. Synthesizes ~150,000 baseline variables encompassing credit history patterns, income metrics, and financial markers aligned perfectly with true-world probability curves.
- **AUC Target**: Test AUC is verified and enforced strictly above `0.85`.
- **Mitigation Features**: Imbalance mitigated natively via `scale_pos_weight=14` against the 6.7% default base-rate.

## NLP Appeal Processor

The appeal processor avoids keyword-matching heuristics and instead maps semantic intent. When users submit an appeal referencing unstructured evidence (e.g., "I lost my job to COVID"), the text is projected through `all-MiniLM-L6-v2` against mapped dictionaries of mitigation assertions. 
If an appeal intersects semantically with these assertions past `.45` thresholds, localized features linked directly to that factor are recursively penalized, recalculating probability boundaries dynamically.

## Selected Endpoints

- `POST /api/decide`: Runs core predictive routines against inputs, yielding feature importances.
- `POST /api/appeal`: Feeds unstructured evidence + ID context through the NLP engine. 
- `POST /api/tone`: Fast heuristic string tone analyzer.
- `POST /api/evidence-strength`: Evaluates text based on length, concepts, assertiveness.
- `GET /api/bias-report`: Returns a digest of bias metrics monitored securely from the Decision Logs.

Example `curl` for inference:
```bash
curl -X 'POST' 'http://127.0.0.1:8000/api/decide' \
  -H 'Content-Type: application/json' \
  -d '{
  "decision_type": "loan",
  "monthly_income": 4500,
  "credit_score": 500,
  "employment_months": 24,
  "defaults": 3,
  "has_gaps": true,
  "has_medical_leave": false,
  "dependents": 1,
  "debt_ratio": 0.5,
  "denial_context": ""
}'
```

## Sample Scenarios

**Scenario A (Denial)**
Input: `credit_score=500`, `has_gaps=true`, `defaults=3` 
Output: Strongly **DENY** due to elevated delinquencies and base factor metrics crossing the 0.35 probability metric boundary securely.

**Scenario B (Successful Recalculation)**
Input: Previous Denial + Appeal: `"medical emergency hospital bills"`
Output: **APPROVE**. The NLP system recognizes the mitigation pattern and adequately weights the severity down, restoring probability metrics to safer margins.

**Scenario C (Unsuccessful Appeal)**
Input: Previous Denial + Appeal: `"I was just lazy"`
Output: **DENY** upheld. Semantic processing fails to map the assertion to any verified risk-mitigation structures.
