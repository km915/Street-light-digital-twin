"""
Flask Model API — Global Model with region_id
=============================================
Serves predictions for all regions using a single global model.
region_id is an input feature — the model learned region-specific
behavior during training.

Start:  python flask_model_api.py
Port:   5001
"""

import json
import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

MODELS_DIR = Path("models")

print("Loading global models...")
energy_model = joblib.load(MODELS_DIR / "energy_model.pkl")
fault_model  = joblib.load(MODELS_DIR / "fault_model.pkl")
preprocessor = joblib.load(MODELS_DIR / "preprocessor.pkl")

with open(MODELS_DIR / "model_metadata.json") as f:
    meta = json.load(f)

FEATURE_COLS    = meta["raw_feature_columns"]
FAULT_THRESHOLD = meta["fault_threshold"]
ALLOWED_VALUES  = meta["allowed_values"]
INPUT_RANGES    = meta["input_ranges"]

print(f"Global model loaded. Features: {FEATURE_COLS}")
print(f"Fault threshold: {FAULT_THRESHOLD:.4f}")


def validate(data: dict):
    for col in FEATURE_COLS:
        if col not in data:
            return False, f"Missing field: {col}"
    for col, allowed in ALLOWED_VALUES.items():
        if data[col] not in allowed:
            return False, f"Bad value for {col}: '{data[col]}'. Allowed: {allowed}"
    return True, ""


def run_prediction(rows: list[dict]) -> list[dict]:
    df_in = pd.DataFrame(rows)[FEATURE_COLS]
    X = preprocessor.transform(df_in)
    energies    = energy_model.predict(X)
    fault_probs = fault_model.predict_proba(X)[:, 1]
    return [
        {
            "predicted_energy_kwh": round(float(max(0.0, e)), 6),
            "fault_probability":    round(float(fp), 4),
            "fault_alert":          float(fp) >= FAULT_THRESHOLD,
        }
        for e, fp in zip(energies, fault_probs)
    ]


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":            "ok",
        "fault_threshold":   FAULT_THRESHOLD,
        "features_expected": FEATURE_COLS,
        "global_model":      True,
    })


@app.route("/predict", methods=["POST"])
def predict_single():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400
    # default region_id to 1 if not provided
    if "region_id" not in data:
        data["region_id"] = 1
    ok, err = validate(data)
    if not ok:
        return jsonify({"error": err}), 422
    return jsonify(run_prediction([data])[0])


@app.route("/predict/batch", methods=["POST"])
def predict_batch():
    data = request.get_json()
    if not data or "lights" not in data:
        return jsonify({"error": 'Expected {"lights": [...]}'}), 400
    lights = data["lights"]
    if not lights:
        return jsonify({"predictions": []})
    # inject region_id if missing
    region_id = data.get("region_id", 1)
    for light in lights:
        if "region_id" not in light:
            light["region_id"] = region_id
    for i, light in enumerate(lights):
        ok, err = validate(light)
        if not ok:
            return jsonify({"error": f"Light {i}: {err}"}), 422
    return jsonify({"predictions": run_prediction(lights)})


@app.route("/whatif", methods=["POST"])
def whatif():
    data = request.get_json()
    if not data or "baseline" not in data or "proposed" not in data:
        return jsonify({"error": 'Expected {"baseline": [...], "proposed": [...]}'}), 400

    region_id = data.get("region_id", 1)
    for lst in [data["baseline"], data["proposed"]]:
        for item in lst:
            if "region_id" not in item:
                item["region_id"] = region_id

    baseline_preds = run_prediction(data["baseline"])
    proposed_preds = run_prediction(data["proposed"])

    comparisons = []
    for b, p in zip(baseline_preds, proposed_preds):
        e_save     = b["predicted_energy_kwh"] - p["predicted_energy_kwh"]
        e_save_pct = (e_save / b["predicted_energy_kwh"] * 100) \
                     if b["predicted_energy_kwh"] > 0 else 0
        comparisons.append({
            "baseline_energy_kwh":  b["predicted_energy_kwh"],
            "proposed_energy_kwh":  p["predicted_energy_kwh"],
            "energy_saving_kwh":    round(e_save, 6),
            "energy_saving_pct":    round(e_save_pct, 2),
            "baseline_fault_prob":  b["fault_probability"],
            "proposed_fault_prob":  p["fault_probability"],
            "fault_prob_delta":     round(p["fault_probability"] - b["fault_probability"], 4),
            "baseline_fault_alert": b["fault_alert"],
            "proposed_fault_alert": p["fault_alert"],
        })

    total_b = sum(c["baseline_energy_kwh"] for c in comparisons)
    total_p = sum(c["proposed_energy_kwh"]  for c in comparisons)
    fleet_saving_pct = ((total_b - total_p) / total_b * 100) if total_b > 0 else 0

    return jsonify({
        "per_light": comparisons,
        "fleet_summary": {
            "total_baseline_energy_kwh": round(total_b, 4),
            "total_proposed_energy_kwh": round(total_p, 4),
            "total_saving_kwh":          round(total_b - total_p, 4),
            "fleet_energy_saving_pct":   round(fleet_saving_pct, 2),
            "lights_count":              len(comparisons),
            "baseline_fault_alerts":     sum(1 for c in comparisons if c["baseline_fault_alert"]),
            "proposed_fault_alerts":     sum(1 for c in comparisons if c["proposed_fault_alert"]),
        }
    })


@app.route("/retrain", methods=["POST"])
def retrain():
    """
    Triggered by Express retraining scheduler.
    Pulls latest data from PostgreSQL (passed in request body),
    retrains both models, reloads them in memory.
    """
    global energy_model, fault_model, preprocessor, meta
    global FEATURE_COLS, FAULT_THRESHOLD, ALLOWED_VALUES, INPUT_RANGES

    data = request.get_json()
    if not data or "rows" not in data:
        return jsonify({"error": 'Expected {"rows": [...]}'}), 400

    rows = data["rows"]
    if len(rows) < 100:
        return jsonify({
            "error": f"Not enough data to retrain. Got {len(rows)} rows, need at least 1000."
        }), 400

    try:
        import subprocess, sys
        # write rows to a temp csv and run the training script
        import tempfile, os
        df = pd.DataFrame(rows)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv',
                                         delete=False) as f:
            df.to_csv(f, index=False)
            tmp_path = f.name

        result = subprocess.run(
            [sys.executable, "train_global_models.py", "--input", tmp_path],
            capture_output=True, text=True, timeout=300,
            encoding="utf-8",
            errors="replace"
        )
        os.unlink(tmp_path)

        if result.returncode != 0:
            return jsonify({"error": result.stderr[-500:]}), 500

        # reload models
        energy_model = joblib.load(MODELS_DIR / "energy_model.pkl")
        fault_model  = joblib.load(MODELS_DIR / "fault_model.pkl")
        preprocessor = joblib.load(MODELS_DIR / "preprocessor.pkl")
        with open(MODELS_DIR / "model_metadata.json") as f:
            meta = json.load(f)
        FEATURE_COLS    = meta["raw_feature_columns"]
        FAULT_THRESHOLD = meta["fault_threshold"]
        ALLOWED_VALUES  = meta["allowed_values"]
        INPUT_RANGES    = meta["input_ranges"]

        print("[Retrain] Models reloaded successfully")
        return jsonify({
            "success":      True,
            "rows_used":    len(rows),
            "roc_auc":      meta["fault_model_metrics"]["roc_auc"],
            "energy_r2":    meta["energy_model_metrics"]["r2"],
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/metadata", methods=["GET"])
def metadata():
    return jsonify(meta)


if __name__ == "__main__":
    print("\nEndpoints:")
    print("  GET  /health          — liveness check")
    print("  GET  /metadata        — model metrics + config")
    print("  POST /predict         — single light (region_id optional, defaults to 1)")
    print("  POST /predict/batch   — batch with region_id")
    print("  POST /whatif          — baseline vs proposed comparison")
    print("  POST /retrain         — trigger model retraining\n")
    app.run(host="0.0.0.0", port=5001, debug=False)