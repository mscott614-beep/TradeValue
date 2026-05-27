import asyncio, os
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv(".env.local")

async def main():
    try:
        api_key = os.environ.get('GOOGLE_GENAI_API_KEY')
        client = genai.Client(api_key=api_key)
        res = await client.aio.models.generate_content(
            model='gemini-3.5-flash', 
            contents='hello', 
            config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())])
        )
        print("Success:", res.text)
    except Exception as e:
        print("Error:", repr(e))

asyncio.run(main())
