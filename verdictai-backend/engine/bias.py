import os
from sqlmodel import Session, create_engine, select, func
from data.schema import DecisionLog, AppealLog, BiasAlert, SQLModel
from datetime import datetime
import json

db_path = os.path.join(os.path.dirname(__file__), "..", "data", "catalyst_bias.db")
sqlite_url = f"sqlite:///{db_path}"

try:
    # Ensure data directory exists
    data_dir = os.path.dirname(db_path)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)
    engine = create_engine(sqlite_url, echo=False)
    # Check writability
    with engine.connect() as conn:
        pass
except Exception as e:
    print(f"[BIAS ENGINE] Disk DB failed: {e}. Falling back to In-Memory mode.")
    sqlite_url = "sqlite://" # Memory fallback
    engine = create_engine(sqlite_url, echo=False)

def init_db():
    try:
        SQLModel.metadata.create_all(engine)
    except Exception as e:
        print(f"[BIAS ENGINE] Initialisation failed: {e}")

def log_decision(decision_data: dict) -> DecisionLog:
    """Logs the decision output from the ML model."""
    feature_vector_str = json.dumps(decision_data.get("feature_vector", {}))
    
    dec_log = DecisionLog(
        decision_type=decision_data.get("decision_type", "loan"),
        input_hash=str(hash(feature_vector_str)),
        decision=decision_data.get("decision", "DENY"),
        confidence=decision_data.get("confidence", 0.0),
        primary_factor=decision_data.get("primary_reason", "Unknown")
    )
    
    try:
        with Session(engine) as session:
            session.add(dec_log)
            session.commit()
            session.refresh(dec_log)
    except Exception as e:
        print(f"[BIAS ENGINE] log_decision failed (silent ignore): {e}")
    
    return dec_log

def log_appeal(appeal_data: dict) -> AppealLog:
    """Logs an appeal against a decision."""
    app_log = AppealLog(
        decision_log_id=int(appeal_data.get("decision_id")),
        appeal_text_length=appeal_data.get("appeal_text_length", 0),
        mitigation_found=appeal_data.get("mitigation_found", False),
        verdict_changed=appeal_data.get("verdict_changed", False),
        old_confidence=appeal_data.get("old_confidence", 0.0),
        new_confidence=appeal_data.get("new_confidence", 0.0)
    )
    
    try:
        with Session(engine) as session:
            session.add(app_log)
            session.commit()
            session.refresh(app_log)
    except Exception as e:
        print(f"[BIAS ENGINE] log_appeal failed (silent ignore): {e}")
        
    return app_log

def compute_bias_metrics() -> dict:
    """
    Computes bias metrics calculating success rates, confidence drops, 
    and raises BiasAlert flags if specific factors flip exceptionally often.
    """
    try:
        with Session(engine) as session:
            # Total appeals
            appeals = session.exec(select(AppealLog)).all()
            total_appeals = len(appeals)
            
            appeal_success_rate = 0.0
            avg_confidence_drop = 0.0
            if total_appeals > 0:
                successes = sum(1 for a in appeals if a.verdict_changed)
                appeal_success_rate = successes / total_appeals
                avg_confidence_drop = sum((a.old_confidence - a.new_confidence) for a in appeals) / total_appeals
                
            # Most commonly mitigated factor
            statement = select(DecisionLog.primary_factor, func.count(DecisionLog.primary_factor)).join(AppealLog).where(AppealLog.mitigation_found == True).group_by(DecisionLog.primary_factor).order_by(func.count(DecisionLog.primary_factor).desc())
            results = session.exec(statement).first()
            most_commonly_mitigated_factor = results[0] if results else "None"
            
            # Decisions where gap was primary
            gap_factor = "Recent Delinquencies"
            gap_decisions = session.exec(select(DecisionLog).where(DecisionLog.primary_factor == gap_factor)).all()
            gap_count = len(gap_decisions)
            
            # How many flipped on appeal
            gap_flips = session.exec(
                select(func.count(AppealLog.id))
                .join(DecisionLog)
                .where(DecisionLog.primary_factor == gap_factor, AppealLog.verdict_changed == True)
            ).first() or 0
            
            gap_flip_percent = (gap_flips / gap_count * 100) if gap_count > 0 else 0.0
            
            alerts = []
            if gap_flip_percent > 15.0:
                alerts.append({
                    "factor": gap_factor,
                    "disparity": gap_flip_percent,
                    "message": f"High disparity in appeal successes for {gap_factor}"
                })
    except Exception as e:
        print(f"[BIAS ENGINE] compute_bias_metrics failed: {e}")
        return {
            "appeal_success_rate": 0.0,
            "avg_confidence_drop_per_appeal": 0.0,
            "most_commonly_mitigated_factor": "Error",
            "decisions_where_gap_was_primary": {"count": 0, "percent_flipped_on_appeal": 0.0},
            "alerts": []
        }
            
    return {
        "appeal_success_rate": appeal_success_rate,
        "avg_confidence_drop_per_appeal": avg_confidence_drop,
        "most_commonly_mitigated_factor": most_commonly_mitigated_factor,
        "decisions_where_gap_was_primary": {
            "count": gap_count,
            "percent_flipped_on_appeal": gap_flip_percent
        },
        "alerts": alerts
    }
