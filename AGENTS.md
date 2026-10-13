# Agent harness learning

Build the user's own agent harness incrementally, using Pi as a reference and Tracelight to observe execution. Start with the minimal agent loop. Add tools, context management, steering, and other features only when the user chooses.

**Hard rule: do not generate or modify application code unless the user explicitly requests it.**

Explain the user's code with breakpoints, visible values, and scratchpad experiments. Read available Pi and Tracelight skills when applicable; do not assume a Pi skill exists. Before explaining runtime behavior, verify the actual visible source position and matching runtime values. Distinguish recordings from live pauses.

Prepare complete scratchpad inputs, helpers, receivers, and mocks atomically. Label simulations, read errors, and repair them automatically before teaching. Do not quiz the user or move to another feature without their direction.
