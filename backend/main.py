from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, Optional
import os
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables
load_dotenv()

app = FastAPI(title="AutoTally Backend API")

# CORS configuration - Allow your React app to access this API
origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
]

# Add production origins from environment variable
prod_origins = os.getenv("ALLOWED_ORIGINS", "")
if prod_origins:
    origins.extend(prod_origins.split(","))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple API key validation
VALID_API_KEYS = os.getenv("BACKEND_API_KEY", "").split(",")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

def validate_api_key(authorization: str = Header(None)):
    """Validate the user's backend API key"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization format")
    
    api_key = authorization.replace("Bearer ", "")
    
    if api_key not in VALID_API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    return api_key


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "online",
        "service": "AutoTally Backend API",
        "version": "2.0.0",
        "features": ["gemini-proxy"]
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy", "message": "Backend is running"}


@app.get("/auth/validate")
async def validate_key(authorization: str = Header(None)):
    """Validate user's API key"""
    try:
        validate_api_key(authorization)
        return {
            "success": True,
            "message": "API key is valid"
        }
    except HTTPException as e:
        return {
            "success": False,
            "message": e.detail
        }


# Pydantic models for Gemini proxy
class GeminiProxyRequest(BaseModel):
    model: str
    contents: Dict[str, Any]
    config: Optional[Dict[str, Any]] = None


@app.post("/ai/gemini-proxy")
async def gemini_proxy(
    request: GeminiProxyRequest,
    authorization: str = Header(None)
):
    """
    Proxy endpoint for Gemini API calls.
    All business logic stays in React - this just forwards the request securely.
    """
    # Validate user's API key
    validate_api_key(authorization)
    
    # Check if Gemini API key is configured
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Gemini API key not configured on server"
        )
    
    try:
        # Configure Gemini with server's API key
        genai.configure(api_key=GEMINI_API_KEY)
        
        # Get the model
        model = genai.GenerativeModel(request.model)
        
        # Generate content with the provided configuration
        generation_config = request.config or {}
        
        response = model.generate_content(
            contents=request.contents,
            generation_config=generation_config
        )
        
        # Return the response
        return {
            "success": True,
            "text": response.text,
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": part.text} for part in candidate.content.parts],
                        "role": candidate.content.role
                    },
                    "finish_reason": candidate.finish_reason,
                    "safety_ratings": [
                        {
                            "category": rating.category,
                            "probability": rating.probability
                        }
                        for rating in candidate.safety_ratings
                    ]
                }
                for candidate in response.candidates
            ]
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Gemini API error: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
