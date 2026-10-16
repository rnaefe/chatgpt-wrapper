# Adapter architecture

Target interface: capabilities(), execute(task), cancel(task), health().

Planned experimental Playwright browser worker: persistent user-owned browser profile, one-time visible login, subsequent unattended/headless operation only if permitted, UI completion detection, structured text and image artifact capture, and explicit failure states for login/challenge/rate-limit/UI changes. No stealth or circumvention.

This adapter is **not implemented and must remain disabled until provider permission/terms review is resolved**. For automatic production execution, implement an authorized API or local-model adapter using the same interface.
