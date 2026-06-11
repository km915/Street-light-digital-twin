"""
Global Model Training — with region_id as feature
==================================================
1. Adds region_id=1 to existing synthetic_data.csv
2. Trains RandomForestRegressor + RandomForestClassifier
   with region_id as an input feature
3. Saves all artifacts to models/
4. Updates flask_model_api.py to handle region_id

Run from the ml/ directory:
  python3 train_global_models.py
"""

import json
import warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import joblib
from pathlib import Path

from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    classification_report, roc_auc_score,
    precision_recall_curve, average_precision_score
)

import sys
import argparse

warnings.filterwarnings('ignore')
np.random.seed(42)

MODELS_DIR = Path('models')
MODELS_DIR.mkdir(exist_ok=True)


parser = argparse.ArgumentParser()
parser.add_argument('--input', type=str, default='synthetic_data.csv',
                    help='Path to input CSV file')
args, _ = parser.parse_known_args()

INPUT_CSV = args.input

# ── step 1: load existing data and add region_id ──────────────────────────────
print('Loading synthetic_data.csv...')
df = pd.read_csv(INPUT_CSV)
print(f'  Source: {INPUT_CSV}')
print(f'  Loaded {len(df):,} rows, {len(df.columns)} columns')

# add region_id — all existing data belongs to region 1 (IIT KGP)
df['region_id'] = 1

print(f'  Added region_id=1 to all rows')
print(f'  Columns: {df.columns.tolist()}')

# ── step 2: define features ───────────────────────────────────────────────────
# categorical features — need OneHotEncoding
CAT_FEATURES = ['lamp_type', 'weather']

# numeric features — includes region_id as a numeric feature
# region_id is numeric (integer) not categorical because:
# - it allows the model to generalise to new regions
# - new region data will have a new integer ID
# - StandardScaler normalises it like any other number
NUM_FEATURES = [
    'rated_power', 'efficiency', 'hour', 'is_night',
    'brightness', 'ambient_light', 'health_score',
    'region_id',   # <-- the new global feature
]

FEATURE_COLS = CAT_FEATURES + NUM_FEATURES
TARGET_E     = 'energy_consumed'
TARGET_F     = 'fault_occurred'

print(f'\nFeature columns ({len(FEATURE_COLS)}): {FEATURE_COLS}')

# ── step 3: ensure all categorical values present (handles small datasets) ────
EXPECTED_WEATHERS   = ['clear', 'cloudy', 'rainy', 'foggy', 'stormy']
EXPECTED_LAMP_TYPES = ['LED', 'HPS', 'MH']

df_fit = df.copy()  # used only for fitting encoder

for w in EXPECTED_WEATHERS:
    if w not in df_fit['weather'].values:
        pad = df_fit.iloc[0].copy()
        pad['weather'] = w
        df_fit = pd.concat([df_fit, pd.DataFrame([pad])], ignore_index=True)

for l in EXPECTED_LAMP_TYPES:
    if l not in df_fit['lamp_type'].values:
        pad = df_fit.iloc[0].copy()
        pad['lamp_type'] = l
        df_fit = pd.concat([df_fit, pd.DataFrame([pad])], ignore_index=True)

preprocessor = ColumnTransformer(transformers=[
    ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), CAT_FEATURES),
    ('num', StandardScaler(), NUM_FEATURES),
], remainder='drop')

preprocessor.fit(df_fit[FEATURE_COLS])

cat_names = preprocessor.named_transformers_['cat'].get_feature_names_out(
    CAT_FEATURES
)
final_feature_names = list(cat_names) + NUM_FEATURES

print(f'Features after encoding: {len(final_feature_names)}')
print(f'Final names: {final_feature_names}')

# ── step 4: train/test split ─────────────────────────────────────────────────
y_e_all = df[TARGET_E].values
y_f_all = df[TARGET_F].values
X_all   = preprocessor.transform(df[FEATURE_COLS])

print(f'\nDataset: {len(df):,} rows')
print(f'Fault rate: {y_f_all.mean():.4f}')

# ensure both classes exist
if len(set(y_f_all)) < 2:
    print('Only one fault class present — adding minimal synthetic rows to enable training')

    minority = 1 - int(y_f_all[0])
    n_syn    = max(5, len(y_f_all) // 20)

    X_all   = np.vstack([X_all, X_all[:n_syn]])
    y_e_all = np.concatenate([y_e_all, y_e_all[:n_syn]])
    y_f_all = np.concatenate([
        y_f_all,
        np.array([minority] * n_syn)
    ])

    print(f'  Added {n_syn} synthetic fault rows')

from sklearn.model_selection import train_test_split as sk_split

test_size = 0.2 if len(X_all) >= 50 else 0.1

X_train, X_test, y_e_tr, y_e_te, y_f_tr, y_f_te = sk_split(
    X_all,
    y_e_all,
    y_f_all,
    test_size=test_size,
    random_state=42,
    stratify=y_f_all
)

print(f'Train: {len(X_train):,} | Test: {len(X_test):,}')

# ── step 5: train energy regressor ───────────────────────────────────────────
print('\nTraining Energy Regressor...')
energy_model = RandomForestRegressor(
    n_estimators=100, max_depth=20,
    min_samples_leaf=5, n_jobs=-1, random_state=42
)
energy_model.fit(X_train, y_e_tr)

y_pred_e = energy_model.predict(X_test)
r2   = r2_score(y_e_te, y_pred_e)
mae  = mean_absolute_error(y_e_te, y_pred_e)
rmse = np.sqrt(mean_squared_error(y_e_te, y_pred_e))
mask_on = y_e_te > 0
mape = np.mean(np.abs((y_e_te[mask_on] - y_pred_e[mask_on]) / y_e_te[mask_on])) * 100

print(f'  R2={r2:.4f}  MAE={mae:.6f}  RMSE={rmse:.6f}  MAPE={mape:.2f}%')
joblib.dump(energy_model, MODELS_DIR / 'energy_model.pkl')
print('  Saved energy_model.pkl')

# ── step 6: train fault classifier ───────────────────────────────────────────
print('\nTraining Fault Classifier...')
fault_model = RandomForestClassifier(
    n_estimators=100, max_depth=15,
    min_samples_leaf=10, class_weight='balanced',
    n_jobs=-1, random_state=42
)
fault_model.fit(X_train, y_f_tr)

y_pred_f      = fault_model.predict(X_test)
y_pred_f_prob = fault_model.predict_proba(X_test)[:, 1]
roc_auc       = roc_auc_score(y_f_te, y_pred_f_prob)
avg_prec      = average_precision_score(y_f_te, y_pred_f_prob)

print(f'  ROC-AUC={roc_auc:.4f}  Avg-Precision={avg_prec:.4f}')
print(classification_report(y_f_te, y_pred_f, target_names=['No Fault', 'Fault']))
joblib.dump(fault_model, MODELS_DIR / 'fault_model.pkl')
print('  Saved fault_model.pkl')

# ── step 7: optimal fault threshold ──────────────────────────────────────────
prec, rec, pr_thresholds = precision_recall_curve(y_f_te, y_pred_f_prob)
f1s      = 2 * (prec[:-1] * rec[:-1]) / (prec[:-1] + rec[:-1] + 1e-9)
best_idx = np.argmax(f1s)
optimal_threshold = pr_thresholds[best_idx]
print(f'\nOptimal threshold: {optimal_threshold:.4f}')

# ── step 8: save preprocessor ────────────────────────────────────────────────
joblib.dump(preprocessor, MODELS_DIR / 'preprocessor.pkl')
print('Saved preprocessor.pkl')

# ── step 9: save metadata ─────────────────────────────────────────────────────
metadata = {
    'fault_threshold':      float(optimal_threshold),
    'raw_feature_columns':  FEATURE_COLS,
    'categorical_features': CAT_FEATURES,
    'numeric_features':     NUM_FEATURES,
    'final_feature_names':  list(final_feature_names),
    'allowed_values': {
        col: sorted(df[col].unique().tolist()) for col in CAT_FEATURES
    },
    'input_ranges': {
        col: {'min': float(df[col].min()), 'max': float(df[col].max())}
        for col in NUM_FEATURES
    },
    'energy_model_metrics': {
        'r2': float(r2), 'mae': float(mae),
        'rmse': float(rmse), 'mape_pct': float(mape)
    },
    'fault_model_metrics': {
        'roc_auc':              float(roc_auc),
        'avg_precision':        float(avg_prec),
        'precision_at_threshold': float(prec[best_idx]),
        'recall_at_threshold':  float(rec[best_idx]),
        'f1_at_threshold':      float(f1s[best_idx])
    },
    'energy_feature_importances': dict(zip(
        final_feature_names,
        [float(x) for x in energy_model.feature_importances_]
    )),
    'fault_feature_importances': dict(zip(
        final_feature_names,
        [float(x) for x in fault_model.feature_importances_]
    )),
    'global_model': True,
    'region_id_as_feature': True,
    'trained_on_regions': [1],
    'train_rows': int(X_train.shape[0]),
    'test_rows':  int(X_test.shape[0]),
}

with open(MODELS_DIR / 'model_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=2)
print('Saved model_metadata.json')

with open(MODELS_DIR / 'feature_columns.json', 'w') as f:
    json.dump({
        'raw_feature_columns':   FEATURE_COLS,
        'categorical_features':  CAT_FEATURES,
        'numeric_features':      NUM_FEATURES,
        'final_feature_names':   list(final_feature_names),
        'cat_values': {
            col: sorted(df[col].unique().tolist()) for col in CAT_FEATURES
        }
    }, f, indent=2)
print('Saved feature_columns.json')

# ── step 10: save updated CSV with region_id ──────────────────────────────────
# only overwrite the main dataset if using the default input
if INPUT_CSV == 'synthetic_data.csv':
    df.to_csv('synthetic_data.csv', index=False)
    print('Updated synthetic_data.csv with region_id column')
else:
    print(f'Training from {INPUT_CSV} — synthetic_data.csv not modified')

# ── step 11: feature importance plots ─────────────────────────────────────────
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

fi_e = pd.DataFrame({
    'feature': final_feature_names,
    'importance': energy_model.feature_importances_
}).sort_values('importance')
axes[0].barh(fi_e['feature'], fi_e['importance'], color='#3b82f6')
axes[0].set_title('Energy model feature importances\n(includes region_id)')

fi_f = pd.DataFrame({
    'feature': final_feature_names,
    'importance': fault_model.feature_importances_
}).sort_values('importance')
axes[1].barh(fi_f['feature'], fi_f['importance'], color='#ef4444')
axes[1].set_title('Fault model feature importances\n(includes region_id)')

plt.tight_layout()
plt.savefig(MODELS_DIR / 'feature_importances_global.png', dpi=150, bbox_inches='tight')
plt.close()
print('Saved feature_importances_global.png')

# ── step 12: end-to-end test ──────────────────────────────────────────────────
# print('\n── End-to-end prediction test ──────────────────────────')
loaded_e = joblib.load(MODELS_DIR / 'energy_model.pkl')
loaded_f = joblib.load(MODELS_DIR / 'fault_model.pkl')
loaded_p = joblib.load(MODELS_DIR / 'preprocessor.pkl')
with open(MODELS_DIR / 'model_metadata.json') as f:
    meta = json.load(f)

def predict(state):
    row = pd.DataFrame([state])[meta['raw_feature_columns']]
    X   = loaded_p.transform(row)
    energy     = float(loaded_e.predict(X)[0])
    fault_prob = float(loaded_f.predict_proba(X)[0][1])
    return {
        'predicted_energy_kwh': round(max(0, energy), 6),
        'fault_probability':    round(fault_prob, 4),
        'fault_alert':          fault_prob >= meta['fault_threshold'],
    }

# region 1 (IIT KGP) — healthy LED, clear night
r1 = predict({
    'lamp_type': 'LED', 'weather': 'clear',
    'rated_power': 100, 'efficiency': 1.0,
    'hour': 22, 'is_night': 1, 'brightness': 80.0,
    'ambient_light': 5.0, 'health_score': 90.0,
    'region_id': 1,
})
print(f'Region 1, LED healthy, clear:  energy={r1["predicted_energy_kwh"]:.4f} kWh  fault={r1["fault_probability"]:.4f}')

# region 2 (hypothetical future region) — same specs
r2 = predict({
    'lamp_type': 'LED', 'weather': 'clear',
    'rated_power': 100, 'efficiency': 1.0,
    'hour': 22, 'is_night': 1, 'brightness': 80.0,
    'ambient_light': 5.0, 'health_score': 90.0,
    'region_id': 2,
})
print(f'Region 2, LED healthy, clear:  energy={r2["predicted_energy_kwh"]:.4f} kWh  fault={r2["fault_probability"]:.4f}')
print('(Region 2 uses interpolated predictions — will improve as region 2 data accumulates)')

# stormy, low health, region 1
r3 = predict({
    'lamp_type': 'HPS', 'weather': 'stormy',
    'rated_power': 150, 'efficiency': 0.75,
    'hour': 2, 'is_night': 1, 'brightness': 90.0,
    'ambient_light': 2.0, 'health_score': 15.0,
    'region_id': 1,
})
print(f'Region 1, HPS sick, stormy:    energy={r3["predicted_energy_kwh"]:.4f} kWh  fault={r3["fault_probability"]:.4f}  alert={r3["fault_alert"]}')

# print('\n── Saved files ─────────────────────────────────────────')
for p in sorted(MODELS_DIR.iterdir()):
    print(f'  {p.name:<40} {p.stat().st_size/1024:>7.1f} KB')

print('\nDone. Run python flask_model_api.py to serve the updated models.')
