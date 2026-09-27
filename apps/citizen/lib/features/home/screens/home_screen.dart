import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../features/auth/models/user_model.dart';
import '../../../features/auth/providers/auth_provider.dart';
import '../../../shared/widgets/primary_button.dart';
import '../../../shared/widgets/secondary_button.dart';

/// Placeholder home screen — the dashboard proper arrives in Phase 4.
/// For now it exists to host the entry point into the report flow.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Civic Report'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Logout',
            onPressed: () => context.read<AuthProvider>().logout(),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppConstants.spacingXl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: const BoxDecoration(
                  color: AppColors.primaryLight,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.shield_outlined,
                  size: 36,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(height: AppConstants.spacingLg),
              Text(
                'Welcome${_displayName(user)}!',
                style: AppTextStyles.heading2,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppConstants.spacingSm),
              const Text(
                'Spotted a problem on your street? Photograph it and let the '
                'right people know.',
                style: AppTextStyles.bodyMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppConstants.spacingXl),
              PrimaryButton(
                label: 'Report Issue',
                onPressed: () => context.push(AppRoutes.report),
              ),
              const SizedBox(height: AppConstants.spacingSm),
              SecondaryButton(
                label: 'My Reports',
                icon: Icons.assignment_outlined,
                onPressed: () => context.push(AppRoutes.reports),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Prefers the name the citizen signed up with, and falls back to their
  /// email — accounts created before `full_name` existed have only the latter.
  String _displayName(UserModel? user) {
    if (user == null) return '';

    final name = user.fullName;
    if (name != null && name.trim().isNotEmpty) return ', ${name.trim()}';

    return ', ${user.email}';
  }
}
