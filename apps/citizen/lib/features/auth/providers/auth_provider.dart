import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/services/api_client.dart';
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
/// Owns [permissionsGranted] so the GoRouter redirect stays fully synchronous
/// (no async SharedPreferences read inside the redirect callback).
class AuthProvider extends ChangeNotifier {
  AuthProvider() {
    ApiClient.instance.onSessionExpired = _handleSessionExpired;
    // initialize() is NOT called here — it is called explicitly from main()
    // after runApp so the GoRouter refreshListenable is guaranteed to be
    // subscribed before the first notifyListeners() fires.
  }

  @override
  void dispose() {
    ApiClient.instance.onSessionExpired = null;
    super.dispose();
  }

  final _service = AuthService.instance;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  AuthStatus _status = AuthStatus.initializing;
  UserModel? _user;
  String? _errorMessage;
  bool _isLoading = false;

  /// Loaded once during [initialize] from SharedPreferences.
  /// Updated to true when the user completes the permissions screen.
  bool _permissionsGranted = false;

  AuthStatus get status => _status;
  UserModel? get user => _user;
  String? get errorMessage => _errorMessage;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _status == AuthStatus.authenticated;
  bool get permissionsGranted => _permissionsGranted;

  // ---------------------------------------------------------------------------
  // Initialise
  // ---------------------------------------------------------------------------

  Future<void> initialize() async {
    // The whole body is guarded so this future can never reject and can never
    // leave [_status] as `initializing`. main() fires this without awaiting it,
    // so an uncaught throw here would be silent — and the router would park on
    // the splash screen forever with no error to explain why.
    try {
      // Read the permissions flag once here — keeps the router redirect sync.
      final prefs = await SharedPreferences.getInstance();
      _permissionsGranted =
          prefs.getBool(AppConstants.keyPermissionsGranted) ?? false;

      final hasSession = await _service.hasSession();
      if (hasSession) {
        _user = await _service.getMe();
        _status = AuthStatus.authenticated;
      } else {
        _status = AuthStatus.unauthenticated;
      }
    } catch (_) {
      // Any failure (storage, network, malformed response) means we cannot
      // prove there is a session — fall back to signed-out.
      _permissionsGranted = false;
      _user = null;
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
    } catch (_) {
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
    } catch (_) {
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
  // Permissions
  // ---------------------------------------------------------------------------

  /// Called by [PermissionsScreen] after the user grants or skips permissions.
  /// Updates the in-memory flag so the router redirect reacts immediately
  /// without needing another SharedPreferences read.
  Future<void> markPermissionsGranted() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(AppConstants.keyPermissionsGranted, true);
    _permissionsGranted = true;
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  void clearError() => _clearError();

  void _handleSessionExpired() {
    if (_status == AuthStatus.unauthenticated) return;
    _errorMessage = 'Your session expired. Please sign in again.';
    _clearSession();
  }

  void _clearSession() {
    if (_status == AuthStatus.unauthenticated && _user == null) return;
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
