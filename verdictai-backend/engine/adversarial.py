import pandas as pd
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from engine.model import get_feature_names

def find_minimum_flip(feature_vector: dict, model) -> dict:
    """
    Parallelized adversarial search. Runs searches for all 5 features 
    simultaneously to achieve 0ms perception lag.
    """
    
    mutable_features = {
        "RevolvingUtilizationOfUnsecuredLines": {"min": 0.0, "max": 1.0, "step_is_up": False},
        "MonthlyIncome": {"min": 0.0, "max": 50000.0, "step_is_up": True},
        "DebtRatio": {"min": 0.0, "max": 1.0, "step_is_up": False},
        "NumberOfTimes90DaysLate": {"min": 0.0, "max": 10.0, "step_is_up": False, "is_int": True},
        "NumberOfDependents": {"min": 0.0, "max": 10.0, "step_is_up": False, "is_int": True}
    }
    
    col_order = get_feature_names()
    
    # We use a helper function to perform the search for ONE feature
    def search_feature(feat, bounds):
        # Create a THREAD-LOCAL copy of the data
        local_fv = feature_vector.copy()
        local_df = pd.DataFrame([local_fv], columns=col_order)
        
        def get_proba(val):
            local_df.at[0, feat] = val
            return model.predict_proba(local_df)[0, 1]

        curr_val = local_fv.get(feat, 0.0)
        if bounds["step_is_up"]:
            low, high = curr_val, bounds["max"]
        else:
            low, high = bounds["min"], curr_val
            
        is_int = bounds.get("is_int", False)
        needed_val = None
        tolerance = 0.015 # Slightly higher tolerance (0.015 instead of 0.01) for search speed
        
        # Binary search - capped at 14 iterations for extreme performance
        for _ in range(14):
            if is_int:
                if high - low <= 1:
                    if get_proba(np.ceil(high)) <= 0.35 and bounds["step_is_up"]: needed_val = np.ceil(high)
                    elif get_proba(np.floor(low)) <= 0.35 and not bounds["step_is_up"]: needed_val = np.floor(low)
                    break
                mid = np.round((low + high) / 2)
            else:
                if high - low < tolerance:
                    needed_val = (low + high) / 2
                    break
                mid = (low + high) / 2
                
            if get_proba(mid) <= 0.35:
                needed_val = mid
                if bounds["step_is_up"]: high = mid
                else: low = mid
            else:
                if bounds["step_is_up"]: low = mid + (1 if is_int else tolerance)
                else: high = mid - (1 if is_int else tolerance)
            
        if needed_val is not None:
            if get_proba(needed_val) <= 0.35:
                delta = abs(needed_val - curr_val)
                pct_change = delta / max(abs(curr_val), 1)
                
                desc = ""
                if feat == "MonthlyIncome": desc = f"If your monthly income were ₹{int(needed_val - curr_val):,.0f} higher..."
                elif feat == "RevolvingUtilizationOfUnsecuredLines": desc = f"If your credit utilization dropped to {needed_val*100:.1f}%..."
                elif feat == "NumberOfTimes90DaysLate": desc = f"If you had {int(curr_val - needed_val)} fewer late payments..."
                elif feat == "DebtRatio": desc = f"If your debt ratio dropped to {needed_val:.2f}..."
                elif feat == "NumberOfDependents": desc = f"If you had {int(curr_val - needed_val)} fewer dependents..."
                
                return {
                    "feature": feat,
                    "delta": float(delta),
                    "pct_change": float(pct_change),
                    "human_description": desc
                }
        return None

    # Run all feature searches in parallel
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(lambda f: search_feature(f, mutable_features[f]), mutable_features))
        
    gaps = [r for r in results if r is not None]
    if not gaps: return None
    return sorted(gaps, key=lambda x: x["pct_change"])[0]
