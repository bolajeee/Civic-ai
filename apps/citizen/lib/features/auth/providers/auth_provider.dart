import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../../../core/errors/api_exception.dart';
import '../models/user_model.dart';
import '../services/auth_service.dart';

enum AuthStatus {
  /// App just launched — checking storage for an existing session
  initializing,

  /// No valid session — show login/register
  unauthenticated,

  /// Valid session — show home
  authenticated,
}

/// Holds all auth state and exposes actions consumed by screens.
///
/// Lifecycle:
///   1. App starts → [initialize] checks secure storage for existing tokens.
///   2. User logs in/registers → [login] / [register] → status becomes [authenticated].
///   3. Any 401 the API interceptor can't recover from → [_clearSession] →
///      status becomes [unauthenticated] → router redirects to login.
class AuthProvider extends ChangeNotifier {
  AuthProvider() {
    initialize();
  }

  final _service = AuthService.instance;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  AuthStatus _status = AuthStatus.initializing;
  UserModel? _user;
  String? _errorMessage;
  bool _isLoading = false;

  AuthStatus get status => _status;
  UserModel? get user => _user;
  String? get errorMessage => _errorMessage;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _status == AuthStatus.authenticated;

  // ---------------------------------------------------------------------------
  // Initialise (session restore on app launch)
  // ---------------------------------------------------------------------------

  Future<void> initialize() async {
    try {
      final hasSession = await _service.hasSession();
      if (hasSession) {
        // Try fetching the user profile to validate the stored token
        _user = await _service.getMe();
        _status = AuthStatus.authenticated;
      } else {
        _status = AuthStatus.unauthenticated;
      }
    } catch (_) {
      // Token may be expired and refresh failed — treat as unauthenticated
      _status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------

  Future<bool> register({
    required String fullName,
    required String nin,
    required String email,
    required String password,
    String? phone,
  }) async {
    _setLoading(true);
    _clearError();

    try {
      final auth = await _service.register(
        fullName: fullName,
        nin: nin,
        email: email,
        password: password,
        phone: phone,
      );
      _user = auth.user;
      _status = AuthStatus.authenticated;
      notifyListeners();
      return true;
    } on DioException catch (e) {
      _setError(ApiException.fromDio(e).message);
      return false;
    } catch (e) {
      _setError('An unexpected error occurred. Please try again.');
      return false;
    } finally {
      _setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  Future<bool> login({
    required String email,
    required String password,
  }) async {
    _setLoading(true);
    _clearError();

    try {
      final auth = await _service.login(email: email, password: password);
      _user = auth.user;
      _status = AuthStatus.authenticated;
      notifyListeners();
      return true;
    } on DioException catch (e) {
      _setError(ApiException.fromDio(e).message);
      return false;
    } catch (e) {
      _setError('An unexpected error occurred. Please try again.');
      return false;
    } finally {
      _setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  Future<void> logout() async {
    _setLoading(true);
    await _service.logout();
    _clearSession();
    _setLoading(false);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  void clearError() => _clearError();

  void _clearSession() {
    _user = null;
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  void _setError(String message) {
    _errorMessage = message;
    notifyListeners();
  }

  void _clearError() {
    if (_errorMessage != null) {
      _errorMessage = null;
      notifyListeners();
    }
  }
}
