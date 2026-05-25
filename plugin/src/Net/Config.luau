--!nocheck
-- Connection config for the bridge server.

return {
	serverUrl = "http://127.0.0.1:58741",
	pollHoldSeconds = 30, -- must exceed the server's 25s long-poll hold
	retryDelaySeconds = 2,
	version = "0.5.0",
}
