"""Bounded HTTP concurrency and audio work queues; standard library only."""
from http.server import ThreadingHTTPServer
from queue import Queue, Full
from threading import BoundedSemaphore, Thread


class BoundedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, handler, max_clients=16):
        self._clients = BoundedSemaphore(max_clients)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self._clients.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._clients.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._clients.release()


class SpeechQueue:
    def __init__(self, speak, lock, capacity=3):
        self._queue = Queue(maxsize=capacity)
        self._speak, self._lock = speak, lock
        Thread(target=self._run, daemon=True).start()

    def submit(self, text):
        try:
            self._queue.put_nowait(text)
            return True
        except Full:
            return False

    def _run(self):
        while True:
            text = self._queue.get()
            try:
                with self._lock:
                    self._speak(text)
            except Exception as error:
                print(f"[audio] speech failed: {type(error).__name__}")
            finally:
                self._queue.task_done()
