import 'package:dio/dio.dart';
import '../constants/app_constants.dart';
import 'token_storage_service.dart';

/// Central Dio client.
///
/// Responsibilities:
///  - Resolves the correct base URL per platform at runtime.
///  - Attaches Bearer token to every request automatically.
///  - On 401 response, attempts a single silent token refresh then retries.
///  - On refresh failure, clears storage (forces re-login).
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  late final Dio _dio = _buildDio();

  Dio get dio => _dio;

  Dio _buildDio() {
    final dio = Dio(
      BaseOptions(
        // baseUrl is resolved at runtime — correct for emulator vs simulator
        baseUrl: AppConstants.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 20),
        headers: {'Content-Type': 'application/json'},
      ),
    );

    dio.interceptors.add(_AuthInterceptor(dio));

    return dio;
  }
}

// ---------------------------------------------------------------------------
// Auth interceptor — token injection + silent refresh on 401
// ---------------------------------------------------------------------------

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this._dio);

  final Dio _dio;
  bool _isRefreshing = false;

  final _storage = TokenStorageService.instance;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _storage.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final path = err.requestOptions.path;
    final is401 = err.response?.statusCode == 401;
    final isAuthEndpoint = path.contains('/auth/login') ||
        path.contains('/auth/register') ||
        path.contains('/auth/refresh');

    if (!is401 || isAuthEndpoint || _isRefreshing) {
      handler.next(err);
      return;
    }

    _isRefreshing = true;

    try {
      final refreshToken = await _storage.getRefreshToken();
      final userId = await _storage.getUserId();

      if (refreshToken == null || userId == null) {
        await _storage.clearAll();
        handler.next(err);
        return;
      }

      final response = await _dio.post(
        '/api/auth/refresh',
        data: {'userId': userId, 'refreshToken': refreshToken},
      );

      final newAccessToken = response.data['accessToken'] as String;
      final newRefreshToken = response.data['refreshToken'] as String;

      await _storage.saveTokens(
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        userId: userId,
      );

      final retryOptions = err.requestOptions
        ..headers['Authorization'] = 'Bearer $newAccessToken';

      final retryResponse = await _dio.fetch(retryOptions);
      handler.resolve(retryResponse);
    } catch (_) {
      await _storage.clearAll();
      handler.next(err);
    } finally {
      _isRefreshing = false;
    }
  }
}
