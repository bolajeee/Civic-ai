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

  /// Invoked when the session can no longer be recovered — the refresh token is
  /// missing, or the silent refresh call itself failed. [AuthProvider] registers
  /// here so an expired session actually reaches the router and redirects to
  /// `/login`, instead of leaving the app parked on a screen it can no longer
  /// load data for.
  ///
  /// A plain callback rather than an `AuthProvider` reference keeps this file
  /// free of a `core → features` dependency.
  void Function()? onSessionExpired;

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

    // Looked up lazily so AuthProvider can register after the client is built.
    dio.interceptors.add(
      _AuthInterceptor(dio, () => onSessionExpired?.call()),
    );

    return dio;
  }
}

// ---------------------------------------------------------------------------
// Auth interceptor — token injection + silent refresh on 401
// ---------------------------------------------------------------------------

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this._dio, this._onSessionExpired);

  final Dio _dio;
  final void Function() _onSessionExpired;
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
    // `/logout` is in the list so a sign-out whose 401 is merely a stale token
    // never kicks off a refresh attempt — which, if it then failed, would raise
    // a "session expired" message on a logout the user asked for.
    final isAuthEndpoint = path.contains('/auth/login') ||
        path.contains('/auth/register') ||
        path.contains('/auth/refresh') ||
        path.contains('/auth/logout');

    if (!is401 || isAuthEndpoint || _isRefreshing) {
      handler.next(err);
      return;
    }

    _isRefreshing = true;

    try {
      final refreshToken = await _storage.getRefreshToken();
      final userId = await _storage.getUserId();

      if (refreshToken == null || userId == null) {
        await _expireSession();
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
      await _expireSession();
      handler.next(err);
    } finally {
      _isRefreshing = false;
    }
  }

  /// Wipes stored credentials and reports the dead session upward, so the app
  /// routes to `/login` instead of retrying forever against a session that is
  /// already gone.
  Future<void> _expireSession() async {
    await _storage.clearAll();
    _onSessionExpired();
  }
}
