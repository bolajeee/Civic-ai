import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../features/auth/providers/auth_provider.dart';
import '../../features/sos/services/sos_text.dart';
import '../constants/app_colors.dart';
import '../constants/app_constants.dart';
import '../theme/app_colors_extension.dart';
import 'app_lock.dart';

/// Covers the whole app with the lock screen while [AppLock] is locked and a
/// citizen is signed in. The app underneath stays mounted, so an SOS in
/// progress (and its location updates) keeps running.
class AppLockGate extends StatelessWidget {
  const AppLockGate({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final lock = context.watch<AppLock>();
    final signedIn = context.select<AuthProvider, bool>((a) => a.isAuthenticated);
    final locked = lock.locked && signedIn;
    return Stack(
      children: [
        ExcludeSemantics(
          excluding: locked,
          child: IgnorePointer(ignoring: locked, child: child),
        ),
        if (locked) const Positioned.fill(child: _LockScreen()),
      ],
    );
  }
}

class _LockScreen extends StatefulWidget {
  const _LockScreen();

  @override
  State<_LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<_LockScreen> {
  @override
  void initState() {
    super.initState();
    // Ask straight away; the button is there if they dismiss the prompt.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<AppLock>().unlock();
    });
  }

  @override
  Widget build(BuildContext context) {
    final lock = context.watch<AppLock>();
    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            children: [
              const Spacer(),
              Icon(Icons.lock_outline_rounded,
                  size: 56, color: context.colors.primary),
              const SizedBox(height: AppConstants.spacingMd),
              Text('Civic Report is locked',
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center),
              const SizedBox(height: AppConstants.spacingSm),
              Text(
                lock.message ??
                    'Use your fingerprint, face or phone PIN to continue.',
                style: context.textStyles.bodyMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppConstants.spacingLg),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: lock.authenticating ? null : lock.unlock,
                  icon: const Icon(Icons.fingerprint),
                  label: const Text('Unlock'),
                ),
              ),
              const Spacer(),
              // An emergency call never waits behind the lock.
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.error,
                    side: const BorderSide(color: AppColors.error),
                  ),
                  onPressed: () {
                    lock.allowNextResume();
                    launchUrl(telUri('112'));
                  },
                  icon: const Icon(Icons.call),
                  label: const Text('Emergency call 112'),
                ),
              ),
              const SizedBox(height: AppConstants.spacingMd),
            ],
          ),
        ),
      ),
    );
  }
}
