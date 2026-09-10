import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../constants/app_constants.dart';

/// Wraps flutter_secure_storage for all token I/O.
/// Tokens are stored encrypted in the device keychain / keystore.
class TokenStorageService {
  TokenStorageService._();
  static final TokenStorageService instance = TokenStorageService._();

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
    required String userId,
  }) async {
    await Future.wait([
      _storage.write(key: AppConstants.keyAccessToken, value: accessToken),
      _storage.write(key: AppConstants.keyRefreshToken, value: refreshToken),
      _storage.write(key: AppConstants.keyUserId, value: userId),
    ]);
  }

  Future<void> saveAccessToken(String token) =>
      _storage.write(key: AppConstants.keyAccessToken, value: token);

  Future<void> saveRefreshToken(String token) =>
      _storage.write(key: AppConstants.keyRefreshToken, value: token);

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  Future<String?> getAccessToken() =>
      _storage.read(key: AppConstants.keyAccessToken);

  Future<String?> getRefreshToken() =>
      _storage.read(key: AppConstants.keyRefreshToken);

  Future<String?> getUserId() =>
      _storage.read(key: AppConstants.keyUserId);

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  Future<void> clearAll() async {
    await Future.wait([
      _storage.delete(key: AppConstants.keyAccessToken),
      _storage.delete(key: AppConstants.keyRefreshToken),
      _storage.delete(key: AppConstants.keyUserId),
    ]);
  }
}
