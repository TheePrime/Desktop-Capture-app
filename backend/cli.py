"""Command-line interface for the desktop capture app."""
import argparse
import os
import sys
import uvicorn
from capture import CaptureConfig
from main import create_app, OUTPUT_BASE

def main():
    parser = argparse.ArgumentParser(description="Desktop capture application")
    parser.add_argument("--hz", type=float, default=1.0,
                       help="Screenshot capture rate in Hz (default: 1.0)")
    parser.add_argument("--output", type=str, default=OUTPUT_BASE,
                       help=f"Output directory for data (default: {OUTPUT_BASE})")
    parser.add_argument("--host", type=str, default="127.0.0.1",
                       help="Host to bind to (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000,
                       help="Port to listen on (default: 8000)")
    
    args = parser.parse_args()
    
    # Ensure output directory exists
    os.makedirs(args.output, exist_ok=True)
    
    # Initialize app with CLI config
    app = create_app()
    app.state.config = CaptureConfig(hz=args.hz, output_base=os.path.abspath(args.output))
    
    # Run server
    uvicorn.run(app, host=args.host, port=args.port)

if __name__ == "__main__":
    sys.exit(main())