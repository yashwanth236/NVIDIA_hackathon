# AccessMate Browser Agent

The Chromium extension works on the active Chrome or Edge tab. It asks for access
to each website separately and sends the user's goal plus visible control labels
to the locally running AccessMate API. It does not send page body text or field
values to NVIDIA NIM.

## Configure and run

1. Set the NVIDIA NIM API key and model in PowerShell. Keep the key private:

   ```powershell
   $env:NVIDIA_NIM_API_KEY = "your-NIM-api-key"
   $env:NVIDIA_NIM_MODEL = "your-enabled-NIM-model"
   ```

   The API key stays in the FastAPI process. The default endpoint is
   `https://integrate.api.nvidia.com/v1`; set `NVIDIA_NIM_BASE_URL` only if
   you use another trusted, OpenAI-compatible NIM endpoint.

2. From the project folder, start the API in the same PowerShell session:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```

3. In Chrome or Edge, open `chrome://extensions` or `edge://extensions`, enable
   Developer mode, choose **Load unpacked**, and select this `extension` folder.
4. Open a website, click the AccessMate extension icon, enter a goal, and start.

## Safety behavior

- Only the active tab is inspected. Each website needs an explicit browser
  permission; a new site pauses until permission is granted.
- The planner receives the goal, page title/origin, and visible control labels.
  Input values and page body text are not sent to the model. Email addresses and
  phone-like strings in labels are redacted.
- Password, authentication, payment, contact, and other likely sensitive fields
  are never filled by the agent. Fill those directly on the website yourself.
- Login, submit, send, delete, purchase, account-change, and similar clicks
  pause for a one-time approval. Rejecting or stopping leaves the action undone.
- The model can request only a click, ordinary text entry, scroll, completion,
  or a user prompt. It cannot execute JavaScript or submit a form directly.
- The agent processes at most 12 low-risk steps per run. Review page changes
  before starting another run.

The agent requires a configured NVIDIA NIM key and model. Without them the API
returns a configuration error and no browser action is taken.
