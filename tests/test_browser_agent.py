import json
import os
import unittest
from unittest.mock import patch

import main


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.body).encode("utf-8")


class BrowserAgentTests(unittest.TestCase):
    def setUp(self):
        self.payload = main.AgentPlanRequest(
            goal="Find the account page",
            page_origin="https://example.test",
            elements=[
                main.BrowserElement(
                    id="control-1",
                    role="a",
                    label="Account",
                    kind="a",
                    external_origin="https://example.test",
                ),
                main.BrowserElement(
                    id="control-2",
                    role="input",
                    label="Password",
                    kind="password",
                    sensitive=True,
                ),
            ],
        )

    def set_model_response(self, action):
        content = json.dumps(action)
        return FakeResponse({"choices": [{"message": {"content": content}}]})

    def test_sensitive_field_is_never_planned_for_automation(self):
        action = {
            "action": "type",
            "element_id": "control-2",
            "value": "secret",
            "reason": "Enter the password",
        }
        with patch.dict(
            os.environ,
            {"NVIDIA_NIM_API_KEY": "test-key", "NVIDIA_NIM_MODEL": "test-model"},
        ):
            with patch(
                "main.urllib.request.urlopen",
                return_value=self.set_model_response(action),
            ):
                plan = main._request_nim_plan(self.payload)

        self.assertEqual(plan.action, "ask_user")
        self.assertIn("fill it in yourself", plan.reason)

    def test_unknown_control_id_is_rejected(self):
        action = {
            "action": "click",
            "element_id": "not-on-page",
            "value": None,
            "reason": "Click a control",
        }
        with patch.dict(
            os.environ,
            {"NVIDIA_NIM_API_KEY": "test-key", "NVIDIA_NIM_MODEL": "test-model"},
        ):
            with patch(
                "main.urllib.request.urlopen",
                return_value=self.set_model_response(action),
            ):
                with self.assertRaisesRegex(RuntimeError, "not on the current page"):
                    main._request_nim_plan(self.payload)

    def test_valid_control_plan_is_returned(self):
        action = {
            "action": "click",
            "element_id": "control-1",
            "value": None,
            "reason": "Open the account page",
        }
        with patch.dict(
            os.environ,
            {"NVIDIA_NIM_API_KEY": "test-key", "NVIDIA_NIM_MODEL": "test-model"},
        ):
            with patch(
                "main.urllib.request.urlopen",
                return_value=self.set_model_response(action),
            ):
                plan = main._request_nim_plan(self.payload)

        self.assertEqual(plan.action, "click")
        self.assertEqual(plan.element_id, "control-1")

    def test_missing_nim_configuration_is_reported(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "NVIDIA_NIM_API_KEY"):
                main._request_nim_plan(self.payload)


if __name__ == "__main__":
    unittest.main()
