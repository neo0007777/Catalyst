import os
import pandas as pd
import numpy as np
import logging
from sklearn.model_selection import train_test_split

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_PATH = os.path.join(os.path.dirname(__file__), "cs-training.csv")

def synthesize_data() -> pd.DataFrame:
    """
    Synthesize the 'Give Me Some Credit' dataset with known distributions.
    """
    logger.info("Synthesizing dataset...")
    n_samples = 150000
    

    # Monthly Income: log-normal mean=6670, std=14384
    mean_X = 6670
    var_X = 14384 ** 2
    sigma = np.sqrt(np.log(1 + var_X / (mean_X ** 2)))
    mu = np.log(mean_X) - (sigma ** 2) / 2
    income = np.random.lognormal(mu, sigma, n_samples)
    
    # Add nulls (19%)
    mask = np.random.choice([True, False], size=n_samples, p=[0.19, 1 - 0.19])
    income = income.astype(float)
    income[mask] = np.nan
    
    # Age: normal mean=52.3, std=14.9, min 21, max 109
    age = np.random.normal(52.3, 14.9, n_samples)
    age = np.clip(age, 21, 109).astype(int)
    
    # DebtRatio: mean=0.353, std=0.375 (use normal + clip to positive)
    debt_ratio = np.abs(np.random.normal(0.353, 0.375, n_samples))
    
    # RevolvingUtilizationOfUnsecuredLines: mean=0.316, std=0.378
    utilization = np.abs(np.random.normal(0.316, 0.378, n_samples))
    
    # NumberOfDependents: mean=0.757, std=1.115
    dependents = np.clip(np.random.normal(0.757, 1.115, n_samples), 0, None)
    dependents = np.round(dependents).astype(float)
    # Inject some nulls (e.g., 2%)
    dep_mask = np.random.choice([True, False], size=n_samples, p=[0.02, 0.98])
    dependents[dep_mask] = np.nan
    
    # Delinquencies
    # 30-59: 94% 0, heavy zero-inflation
    p30 = [0.94, 0.04, 0.01, 0.01]
    n30 = np.random.choice([0, 1, 2, 3], size=n_samples, p=p30)
    
    # 60-89: (synthetic approximation)
    n60 = np.random.choice([0, 1, 2], size=n_samples, p=[0.95, 0.04, 0.01])
    
    # 90+: 96% 0
    n90 = np.random.choice([0, 1, 2, 3], size=n_samples, p=[0.96, 0.02, 0.01, 0.01])
    
    # NumberOfOpenCreditLinesAndLoans
    open_lines = np.random.poisson(8, n_samples)
    
    # NumberRealEstateLoansOrLines
    real_estate = np.random.poisson(1, n_samples)

    # Correlate Target to features to guarantee learnable synthetic patterns
    raw_income = np.nan_to_num(income, nan=5400.0)
    score = (utilization * 3.0) - (np.log1p(raw_income) / 5.0) + (n30 * 2.0) + (n90 * 4.0) + (debt_ratio * 1.5)
    threshold = np.percentile(score, 100 - 6.7)
    y = (score >= threshold).astype(int)
    # Add small local noise
    flip_mask = np.random.rand(n_samples) < 0.02
    y[flip_mask] = 1 - y[flip_mask]

    df = pd.DataFrame({
        "SeriousDlqin2yrs": y,
        "RevolvingUtilizationOfUnsecuredLines": utilization,
        "age": age,
        "NumberOfTime30-59DaysPastDueNotWorse": n30,
        "DebtRatio": debt_ratio,
        "MonthlyIncome": income,
        "NumberOfOpenCreditLinesAndLoans": open_lines,
        "NumberOfTimes90DaysLate": n90,
        "NumberRealEstateLoansOrLines": real_estate,
        "NumberOfTime60-89DaysPastDueNotWorse": n60,
        "NumberOfDependents": dependents
    })
    
    return df

def clean_and_engineer(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cleans dataset and applies feature engineering.
    """
    # Clean: drop rows where MonthlyIncome is null
    df = df.dropna(subset=["MonthlyIncome"]).copy()
    
    # Impute NumberOfDependents nulls with median
    median_dep = df["NumberOfDependents"].median()
    df["NumberOfDependents"] = df["NumberOfDependents"].fillna(median_dep)
    
    # Cap outliers
    df["RevolvingUtilizationOfUnsecuredLines"] = df["RevolvingUtilizationOfUnsecuredLines"].clip(upper=1.0)
    df["DebtRatio"] = df["DebtRatio"].clip(upper=1.0)
    df["age"] = df["age"].clip(18, 100)
    
    # Feature engineering
    df["income_per_dependent"] = df["MonthlyIncome"] / (df["NumberOfDependents"] + 1)
    df["total_delinquencies"] = (df["NumberOfTime30-59DaysPastDueNotWorse"] + 
                                 df["NumberOfTime60-89DaysPastDueNotWorse"] + 
                                 df["NumberOfTimes90DaysLate"])
    df["credit_utilization_risk"] = df["RevolvingUtilizationOfUnsecuredLines"] * df["DebtRatio"]
    
    # Employment stability score computed from age and delinquency pattern 
    # e.g., age (proxy for experience) reduced by severe delinquencies
    df["employment_stability_score"] = (df["age"] / 10.0) - df["total_delinquencies"]
    
    return df

def get_train_test_split() -> tuple:
    """
    Retrieves the dataset, cleans it, engineers features, and 
    splits it into the train and test split.
    """
    if os.path.exists(DATA_PATH):
        logger.info("Found cs-training.csv. Loading...")
        df = pd.read_csv(DATA_PATH)
    else:
        logger.info("c-training.csv not found.")
        df = synthesize_data()
        
    df = clean_and_engineer(df)
    
    X = df.drop(columns=["SeriousDlqin2yrs", "Unnamed: 0"], errors="ignore")
    y = df["SeriousDlqin2yrs"]
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=42
    )
    
    return X_train, X_test, y_train, y_test
