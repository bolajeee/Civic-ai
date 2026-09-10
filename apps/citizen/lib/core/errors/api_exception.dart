import 'package:dio/dio.dart';

/// A clean error type surfaced to UI layers — no Dio internals leaked upward.
class ApiException implements Exception {
  final String message;
  final int? statusCode;

  const ApiException({required this.message, this.statusCode});

  factory ApiException.fromDio(DioException e) {
    final statusCode = e.response?.statusCode;

    // -------------------------------------------------------------------------
    // Network / connectivity errors — checked before response parsing
    // -------------------------------------------------------------------------
    switch (e.type) {
      case DioExceptionType.connectionError:
        return const ApiException(
          message:
              'Cannot reach the server. Make sure the API is running and your '
              'device is on the same network.',
        );
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const ApiException(
          message:
              'Request timed out. Check your internet connection and try again.',
        );
      case DioExceptionType.cancel:
        return const ApiException(message: 'Request was cancelled.');
      default:
        break;
    }

    // -------------------------------------------------------------------------
    // Server responded — parse the API error body
    // -------------------------------------------------------------------------
    String message = _fallbackMessage(statusCode);

    final data = e.response?.data;
    if (data is Map<String, dynamic>) {
      if (data['error'] is String && (data['error'] as String).isNotEmpty) {
        message = data['error'] as String;
      } else if (data['error'] is List) {
        // Zod validation error array — take the first message
        final errors = data['error'] as List;
        if (errors.isNotEmpty && errors.first is Map) {
          final firstMsg = (errors.first as Map)['message']?.toString();
          if (firstMsg != null && firstMsg.isNotEmpty) message = firstMsg;
        }
      }
    }

    return ApiException(message: message, statusCode: statusCode);
  }

  static String _fallbackMessage(int? code) {
    switch (code) {
      case 400:
        return 'Invalid request. Please check your details and try again.';
      case 401:
        return 'Invalid email or password.';
      case 403:
        return 'Access denied.';
      case 404:
        return 'Resource not found.';
      case 409:
        return 'A conflict occurred. The resource may already exist.';
      case 422:
        return 'Validation failed. Please check your input.';
      case 429:
        return 'Too many requests. Please slow down and try again.';
      case 500:
      case 502:
      case 503:
        return 'Server error. Please try again in a moment.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  @override
  String toString() => 'ApiException($statusCode): $message';
}
