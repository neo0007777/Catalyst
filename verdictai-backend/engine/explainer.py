import shap
import pandas as pd
import numpy as np
import os
import json
from engine.ai_bridge import AIBridge
from engine.model import get_model, get_feature_names

# Restored Original Baseline Mappings
BASELINES = {
    "RevolvingUtilizationOfUnsecuredLines": {"mean": 0.316, "unit": "%", "scale": 100},
    "MonthlyIncome": {"median": 5400, "mean": 6670, "unit": "₹", "scale": 1},
    "DebtRatio": {"mean": 0.353, "unit": "ratio", "scale": 1},
    "NumberOfTimes90DaysLate": {"mode": 0, "unit": "times", "scale": 1},
    "NumberOfTime30-59DaysPastDueNotWorse": {"mode": 0, "unit": "times", "scale": 1},
    "NumberOfDependents": {"mean": 0.757, "unit": "people", "scale": 1},
    "total_delinquencies": {"mean": 0.5, "unit": "points", "scale": 1},
    "credit_utilization_risk": {"mean": 0.1, "unit": "score", "scale": 1},
    "income_per_dependent": {"median": 4000, "unit": "₹", "scale": 1},
    "employment_stability_score": {"mean": 4.5, "unit": "score", "scale": 1}
}

NAME_MAPPING = {
    "RevolvingUtilizationOfUnsecuredLines": "Credit Utilization",
    "MonthlyIncome": "Monthly Income",
    "DebtRatio": "Debt-to-Income Ratio",
    "NumberOfTimes90DaysLate": "Payment History",
    "NumberOfTime30-59DaysPastDueNotWorse": "Recent Delinquencies",
    "NumberOfDependents": "Number of Dependents",
    "total_delinquencies": "Total Delinquency Score",
    "credit_utilization_risk": "Combined Credit Risk",
    "income_per_dependent": "Income per Dependent",
    "employment_stability_score": "Employment Stability"
}

_explainer = None

def get_explainer():
    global _explainer
    if _explainer is None:
        model = get_model()
        _explainer = shap.TreeExplainer(model)
    return _explainer

def build_baseline_explanation(col: str, val: float, s_val: float) -> str:
    """
    Generates a mathematical comparison against industry baselines.
    """
    hname = NAME_MAPPING.get(col, col.replace("_", " ").title())
    b_info = BASELINES.get(col, {"mean": val, "unit": "", "scale": 1})
    
    target = b_info.get("median") or b_info.get("mean") or b_info.get("mode") or 0
    unit = b_info.get("unit", "")
    scale = b_info.get("scale", 1)
    
    disp_val = val * scale
    is_risk = s_val > 0
    
    if is_risk:
        return f"Your {hname} of {disp_val:,.1f}{unit} is influencing the risk profile compared to the baseline of {target:,.1f}{unit}."
    else:
        return f"Your {hname} of {disp_val:,.1f}{unit} is within the safe operational range (Target: {target:,.1f}{unit})."

def explain(feature_vector: dict, prediction: dict) -> list:
    """
    Factor explanation logic driven by original BASELINES.
    """
    explainer = get_explainer()
    ordered_cols = get_feature_names()
    df = pd.DataFrame([feature_vector], columns=ordered_cols)
    
    shap_values = explainer.shap_values(df)[0]
    
    raw_factors = []
    for i, col in enumerate(ordered_cols):
        s_val = shap_values[i]
        if abs(s_val) > 0.01:
            direction = "risk" if s_val > 0 else "safe"
            weight = min(100, int(abs(s_val) * 400)) 
                
            # Determine the human-readable label
            label = NAME_MAPPING.get(col, col.replace("_", " ").title())
                
            raw_factors.append({
                "name": label,
                "human_name": label,
                "label": label,
                "factor_name": col,
                "direction": direction,
                "weight": weight,
                "explanation": build_baseline_explanation(col, feature_vector.get(col, 0), s_val),
                "value": feature_vector.get(col, 0)
            })
            
    return sorted(raw_factors, key=lambda x: x["weight"], reverse=True)[:6]

async def generate_advisor_narrative(feature_vector: dict, prediction: dict) -> str:
    outcome = prediction["decision"]
    conf = prediction["confidence"]
    prompt = (
        f"Briefly summarize the financial narrative of this {outcome} decision ({conf}% confidence). "
        f"Details: {json.dumps(feature_vector)}"
    )
    result = await AIBridge.generate_text(prompt, system_msg="Professional financial audit summary.")
    return result["text"]
