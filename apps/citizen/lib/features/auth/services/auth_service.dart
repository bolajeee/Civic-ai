import 'package:dio/dio.dart';
import '../../../core/services/api_client.dart';
import '../../../core/services/token_storage_service.dart';
import '../models/auth_response_model.dart';
import '../models/user_model.dart';

/// All network calls for the auth feature.
class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();

  final Dio _dio = ApiClient.instance.dio;
  final TokenStorageService _storage = TokenStorageService.instance;

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------

  /// Registers a new CITIZEN account.
  /// Returns [AuthResponseModel] on success and persists tokens to secure storage.
  Future<AuthResponseModel> register({
    required String fullName,
    required String nin,
    required String email,
    required String password,
    String? phone,
  }) async {
    final response = await _dio.post(
      '/api/auth/register',
      data: {
        'email': email,
        'password': password,
        'nin': nin,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
      },
    );

    final auth = AuthResponseModel.fromJson(
      response.data as Map<String, dynamic>,
    );

    await _storage.saveTokens(
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      userId: auth.user.id,
    );

    return auth;
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  /// Authenticates an existing user.
  /// Returns [AuthResponseModel] on success and persists tokens.
  Future<AuthResponseModel> login({
    required String email,
    required String password,
  }) async {
    final response = await _dio.post(
      '/api/auth/login',
      data: {'email': email, 'password': password},
    );

    final auth = AuthResponseModel.fromJson(
      response.data as Map<String, dynamic>,
    );

    await _storage.saveTokens(
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      userId: auth.user.id,
    );

    return auth;
  }

  // ---------------------------------------------------------------------------
  // Me
  // ---------------------------------------------------------------------------

  /// Fetches the authenticated user's profile from the server.
  Future<UserModel> getMe() async {
    final response = await _dio.get('/api/auth/me');
    return UserModel.fromJson(
      (response.data as Map<String, dynamic>)['user'] as Map<String, dynamic>,
    );
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  /// Revokes the current device's refresh token and clears local storage.
  Future<void> logout() async {
    try {
      final refreshToken = await _storage.getRefreshToken();
      if (refreshToken != null) {
        await _dio.post(
          '/api/auth/logout',
          data: {'refreshToken': refreshToken},
        );
      }
    } catch (_) {
      // Best-effort — always clear local tokens even if server call fails
    } finally {
      await _storage.clearAll();
    }
  }

  // ---------------------------------------------------------------------------
  // Session restore
  // ---------------------------------------------------------------------------

  /// Returns true if a valid access token exists in storage.
  /// Used on app launch to decide whether to show splash → home or splash → login.
  Future<bool> hasSession() async {
    final token = await _storage.getAccessToken();
    return token != null && token.isNotEmpty;
  }
}
