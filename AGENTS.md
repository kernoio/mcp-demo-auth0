<!-- kerno instructions start -->
## Kerno usage

Use Kerno after changes that may affect endpoint behavior. It tests the running API against executable endpoint
scenarios to catch regressions that source checks can miss.

Validate affected endpoints before considering the work complete. If an endpoint has no Kerno coverage, ask whether to
add it; creating initial coverage can take time.

Follow Kerno's MCP tool descriptions for the current workflow and parameters. For asynchronous work, read progress
through Kerno's state tools rather than tailing logs.
<!-- kerno instructions end -->
