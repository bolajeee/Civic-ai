import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../../../core/constants/app_constants.dart';

class SocialCredential {
  const SocialCredential({
    required this.provider,
    required this.idToken,
    this.nonce,
  });

  final String provider;
  final String idToken;
  final String? nonce;
}

class SocialAuthService {
  SocialAuthService._();
  static final SocialAuthService instance = SocialAuthService._();

  bool _googleInitialized = false;

  Future<SocialCredential> signInWithGoogle() async {
    if (AppConstants.googleServerClientId.isEmpty) {
      throw StateError(
        'Google sign-in is not configured for this build. Set GOOGLE_SERVER_CLIENT_ID.',
      );
    }
    if (!_googleInitialized) {
      await GoogleSignIn.instance.initialize(
        clientId: AppConstants.googleClientId.isEmpty
            ? null
            : AppConstants.googleClientId,
        serverClientId: AppConstants.googleServerClientId,
      );
      _googleInitialized = true;
    }

    final account = await GoogleSignIn.instance.authenticate();
    final idToken = account.authentication.idToken;
    if (idToken == null || idToken.isEmpty) {
      throw StateError('Google did not return an identity token.');
    }
    return SocialCredential(provider: 'google', idToken: idToken);
  }

  Future<SocialCredential> signInWithApple() async {
    if (!await SignInWithApple.isAvailable()) {
      throw StateError('Apple sign-in is not available on this device.');
    }

    final rawNonce = _randomNonce();
    final hashedNonce = sha256.convert(utf8.encode(rawNonce)).toString();
    final isNativeApple = !kIsWeb &&
        (defaultTargetPlatform == TargetPlatform.iOS ||
            defaultTargetPlatform == TargetPlatform.macOS);

    WebAuthenticationOptions? webOptions;
    if (!isNativeApple) {
      if (AppConstants.appleServiceId.isEmpty ||
          AppConstants.appleRedirectUri.isEmpty) {
        throw StateError(
          'Apple sign-in is not configured for this platform. Set APPLE_SERVICE_ID and APPLE_REDIRECT_URI.',
        );
      }
      webOptions = WebAuthenticationOptions(
        clientId: AppConstants.appleServiceId,
        redirectUri: Uri.parse(AppConstants.appleRedirectUri),
      );
    }

    final credential = await SignInWithApple.getAppleIDCredential(
      scopes: const [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ],
      nonce: hashedNonce,
      webAuthenticationOptions: webOptions,
    );
    final idToken = credential.identityToken;
    if (idToken == null || idToken.isEmpty) {
      throw StateError('Apple did not return an identity token.');
    }
    return SocialCredential(
      provider: 'apple',
      idToken: idToken,
      nonce: rawNonce,
    );
  }

  String _randomNonce([int length = 32]) {
    const characters =
        '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
    final random = Random.secure();
    return List.generate(
      length,
      (_) => characters[random.nextInt(characters.length)],
    ).join();
  }
}
