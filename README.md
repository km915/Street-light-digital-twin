# Street Light Digital Twin Platform

A full-stack digital twin platform for smart street light monitoring,
simulation, and predictive maintenance.

See [docs/REPORT.md](docs/REPORT.md) for full documentation.

## First-Time Setup

Generate the trained ML models before starting Docker:

```bash
cd ml
python generate_data.py
python train_global_models.py
```

Verify that the following files exist in `ml/models/`:

- energy_model.pkl
- fault_model.pkl
- preprocessor.pkl
- feature_columns.json
- model_metadata.json

## Run with Docker

```bash
docker compose up --build
```

Open:

http://localhost

Default login:

username: admin
password: admin123

Select region as IIT Kharagpur and open maintainance section and click "revert to original 50" to load the default street lights.