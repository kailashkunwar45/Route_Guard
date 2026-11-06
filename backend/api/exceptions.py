from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


class ProviderError(Exception):
    def __init__(self, message, status_code=status.HTTP_502_BAD_GATEWAY):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class ValidationBusinessError(Exception):
    def __init__(self, message, status_code=status.HTTP_422_UNPROCESSABLE_ENTITY):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def routeguard_exception_handler(exc, context):
    if isinstance(exc, (ProviderError, ValidationBusinessError)):
        return Response({"detail": exc.message}, status=exc.status_code)
    response = exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict) and "detail" not in response.data:
        # Flatten field errors into a readable detail when useful
        if "non_field_errors" in response.data:
            response.data = {"detail": response.data["non_field_errors"][0]}
    return response
