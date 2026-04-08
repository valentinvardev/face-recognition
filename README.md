# 🏃‍♂️ Marathon Runner Recognition System

A cloud-based recognition system for marathon events. This project identifies runners using a combination of **Roboflow (Bib Detection)**, **EasyOCR (Bib Number Reading)**, and **Face Recognition (Identity Grouping)**.

## 🏗️ Architecture

- **Backend (Modal AI)**: A serverless Python pipeline that processes images using Computer Vision.
- **Frontend (T3 Stack)**: A Next.js web application for managing the runner library and scanning photos.
- **Database (Supabase)**: Persistent storage for runners, sightings, and face encodings.

## 🚀 Getting Started

### 1. Backend (Modal)
The backend is located in `marathon_app.py`.
```bash
python -m modal deploy marathon_app.py
```

### 2. Frontend (Next.js)
The web application is in the `/marathon-web` directory.
```bash
cd marathon-web
npm install
npm run dev
```

## ✨ Key Features
- **Bib-First Identification**: Prioritizes dorsal numbers for identity creation.
- **OCR Integration**: Reads real digits from bibs instead of just detecting boxes.
- **Smart Grouping**: Correlates faces with bibs based on spatial proximity.
- **Premium Library**: Visual gallery with lightboxes for verification.

## 🔑 Environment Variables
You need to set up:
- `ROBOFLOW_API_KEY` (in Modal secret)
- `DATABASE_URL` (in `marathon-web/.env`)
- `NEXT_PUBLIC_MODAL_API_URL`
