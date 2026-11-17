import 'package:flutter/widgets.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Optional app lock: when the citizen turns it on, the app asks for the
/// phone's own fingerprint, face or screen-lock PIN on launch and after it has
/// been in the background for [relockAfter].
///
/// Nothing is stored but an on/off flag: the phone does the checking.
class AppLock extends ChangeNotifier with WidgetsBindingObserver {
  AppLock({LocalAuthentication? auth, this.relockAfter = defaultRelockAfter})
      : _auth = auth ?? LocalAuthentication();

  static final AppLock instance = AppLock();

  static const prefsKey = 'app_lock_enabled';

  /// Short trips out (a photo, a quick reply) do not lock the app again.
  static const defaultRelockAfter = Duration(minutes: 1);
  final Duration relockAfter;

  /// How long a trip the app started itself (the messages app during an SOS,
  /// the dialer) stays exempt.
  static const allowedTripLimit = Duration(minutes: 10);

  final LocalAuthentication _auth;

  bool _enabled = false;
  bool _locked = false;
  bool _authenticating = false;
  bool _observing = false;
  DateTime? _backgroundedAt;
  bool _allowNextResume = false;
  String? _message;

  bool get enabled => _enabled;
  bool get locked => _enabled && _locked;
  bool get authenticating => _authenticating;

  /// Why the last unlock did not succeed, written to be shown as-is.
  String? get message => _message;

  Future<void> initialize() async {
    if (!_observing) {
      WidgetsBinding.instance.addObserver(this);
      _observing = true;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      _enabled = prefs.getBool(prefsKey) ?? false;
      _locked = _enabled;
    } catch (_) {
      // Preferences unavailable: leave the app unlocked rather than stuck.
    }
    notifyListeners();
  }

  /// Turns the lock on or off. Both need the phone's own check, so someone
  /// holding an unlocked phone cannot switch it off. Returns a message to show
  /// when it did not change.
  Future<String?> setEnabled(bool value) async {
    if (value == _enabled) return null;
    if (value) {
      bool supported;
      try {
        supported = await _auth.isDeviceSupported();
      } catch (_) {
        supported = false;
      }
      if (!supported) {
        return 'Set a screen lock (PIN, pattern, fingerprint or face) on your '
            'phone first.';
      }
    }
    final ok = await _authenticate(
      value ? 'Confirm it is you to turn on app lock' : 'Confirm it is you to turn off app lock',
    );
    if (!ok) return _message ?? 'App lock was not changed.';
    _enabled = value;
    _locked = false;
    _message = null;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(prefsKey, value);
    } catch (_) {
      // Applies for this session; saved again the next time it is changed.
    }
    return null;
  }

  Future<bool> unlock() async {
    if (!locked) return true;
    final ok = await _authenticate('Unlock Civic Report');
    if (ok) {
      _locked = false;
      _message = null;
    }
    notifyListeners();
    return ok;
  }

  /// The app is about to open another app (messages, dialer) and the citizen
  /// will come straight back: do not ask them to unlock for that.
  void allowNextResume() => _allowNextResume = true;

  @visibleForTesting
  void debugSet({bool? enabled, bool? locked}) {
    if (enabled != null) _enabled = enabled;
    if (locked != null) _locked = locked;
    notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The fingerprint sheet or PIN screen itself can pause the app.
    if (_authenticating) return;
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        _backgroundedAt ??= DateTime.now();
      case AppLifecycleState.resumed:
        final since = _backgroundedAt;
        final allowed = _allowNextResume;
        _backgroundedAt = null;
        _allowNextResume = false;
        if (!_enabled || since == null) return;
        final away = DateTime.now().difference(since);
        if (allowed && away < allowedTripLimit) return;
        if (away >= relockAfter) {
          _locked = true;
          notifyListeners();
        }
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
        break;
    }
  }

  Future<bool> _authenticate(String reason) async {
    if (_authenticating) return false;
    _authenticating = true;
    _message = null;
    notifyListeners();
    try {
      final ok = await _auth.authenticate(
        localizedReason: reason,
        persistAcrossBackgrounding: true,
      );
      if (!ok) _message = 'Not unlocked. Try again.';
      return ok;
    } on LocalAuthException catch (e) {
      _message = switch (e.code) {
        LocalAuthExceptionCode.noCredentialsSet =>
          'Set a screen lock (PIN, pattern, fingerprint or face) on your phone first.',
        LocalAuthExceptionCode.temporaryLockout ||
        LocalAuthExceptionCode.biometricLockout =>
          'Too many attempts. Wait a moment, or unlock with your phone PIN.',
        _ => 'Not unlocked. Try again.',
      };
      return false;
    } catch (_) {
      _message = 'Not unlocked. Try again.';
      return false;
    } finally {
      _authenticating = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    if (_observing) WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
