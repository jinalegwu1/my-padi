class SpeechError(Exception):
    def __init__(self, status: int, code: str, retry_after_seconds: int = 0):
        super().__init__(code)
        self.status = status
        self.code = code
        self.retry_after_seconds = retry_after_seconds
