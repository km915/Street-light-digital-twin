FROM python:3.11-slim

WORKDIR /app

# install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy everything
COPY . .

# models directory must exist
RUN mkdir -p models

EXPOSE 5001

CMD ["python", "flask_model_api.py"]