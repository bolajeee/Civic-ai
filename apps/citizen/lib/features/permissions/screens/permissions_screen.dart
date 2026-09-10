import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/widgets/primary_button.dart';

/// Shown once after a successful login/register, before navigating to Home.
///
/// Requests camera, location, and notification permissions.
/// The result is stored in SharedPreferences so this screen is only shown
/// once — subsequent app launches go straight to Home.
class PermissionsScreen extends StatefulWidget {
  const PermissionsScreen({super.key});

  @override
  State<PermissionsScreen> createState() => _PermissionsScreenState();
}

class _PermissionsScreenState extends State<PermissionsScreen> {
  bool _isRequesting = false;

  // Track individual grant status for UI feedback
  Map<_PermItem, PermissionStatus> _statuses = {};

  @override
  void initState() {
    super.initState();
    _checkCurrentStatuses();
  }

  /// Check current statuses without prompting — updates the UI to reflect
  /// permissions already granted (e.g. user came back from Settings).
  Future<void> _checkCurrentStatuses() async {
    final results = await Future.wait(
      _permItems.map((item) => item.permission.status),
    );
    if (!mounted) return;
    setState(() {
      _statuses = {
        for (var i = 0; i < _permItems.length; i++) _permItems[i]: results[i],
      };
    });
  }

  Future<void> _requestAll() async {
    setState(() => _isRequesting = true);

    final results = await [
      Permission.camera,
      Permission.locationWhenInUse,
      Permission.notification,
    ].request();

    if (!mounted) return;

    setState(() {
      _statuses = {
        for (final item in _permItems) item: results[item.permission]!,
      };
      _isRequesting = false;
    });

    // Any permanently denied permission → guide to Settings
    final permanentlyDenied = results.values
        .any((s) => s == PermissionStatus.permanentlyDenied);

    if (permanentlyDenied && mounted) {
      _showSettingsDialog();
      return;
    }

    _proceed();
  }

  void _proceed() async {
    // Mark permissions flow as complete so it's skipped on future launches
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(AppConstants.keyPermissionsGranted, true);
    if (mounted) context.go(AppRoutes.home);
  }

  void _showSettingsDialog() {
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppConstants.radiusLg),
        ),
        title: const Text('Permissions Required', style: AppTextStyles.label),
        content: const Text(
          'Some permissions were permanently denied. Please enable them in '
          'Settings to use all features of Civic Report.',
          style: AppTextStyles.bodyMedium,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Skip'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(context).pop();
              await openAppSettings();
            },
            child: const Text(
              'Open Settings',
              style: TextStyle(color: AppColors.primary),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppConstants.spacingLg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppConstants.spacingXxl),

              // Header
              const _PermissionsHeader(),

              const SizedBox(height: AppConstants.spacingXl),

              // Permission cards
              Expanded(
                child: ListView.separated(
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: _permItems.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppConstants.spacingMd),
                  itemBuilder: (_, i) {
                    final item = _permItems[i];
                    final status = _statuses[item];
                    return _PermissionCard(
                      item: item,
                      status: status,
                    );
                  },
                ),
              ),

              const SizedBox(height: AppConstants.spacingXl),

              // CTA
              PrimaryButton(
                label: 'Grant Permissions',
                isLoading: _isRequesting,
                onPressed: _requestAll,
              ),

              const SizedBox(height: AppConstants.spacingMd),

              // Skip — some permissions can be granted later
              Center(
                child: TextButton(
                  onPressed: _isRequesting ? null : _proceed,
                  child: const Text(
                    'Skip for now',
                    style: AppTextStyles.bodyMedium,
                  ),
                ),
              ),

              const SizedBox(height: AppConstants.spacingLg),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Data model for each permission item
// ---------------------------------------------------------------------------

class _PermItem {
  const _PermItem({
    required this.permission,
    required this.icon,
    required this.title,
    required this.description,
  });

  final Permission permission;
  final IconData icon;
  final String title;
  final String description;
}

const List<_PermItem> _permItems = [
  _PermItem(
    permission: Permission.camera,
    icon: Icons.camera_alt_outlined,
    title: 'Camera',
    description:
        'Take photos of infrastructure issues when submitting a report.',
  ),
  _PermItem(
    permission: Permission.locationWhenInUse,
    icon: Icons.location_on_outlined,
    title: 'Location',
    description:
        'Attach your precise GPS coordinates so officers can find the issue.',
  ),
  _PermItem(
    permission: Permission.notification,
    icon: Icons.notifications_outlined,
    title: 'Notifications',
    description:
        'Get updates when your report is reviewed or resolved.',
  ),
];

// ---------------------------------------------------------------------------
// Header widget
// ---------------------------------------------------------------------------

class _PermissionsHeader extends StatelessWidget {
  const _PermissionsHeader();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 52,
          height: 52,
          decoration: const BoxDecoration(
            color: AppColors.primaryLight,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.shield_outlined,
            size: 26,
            color: AppColors.primary,
          ),
        ),
        const SizedBox(height: AppConstants.spacingMd),
        const Text('Allow Access', style: AppTextStyles.heading1),
        const SizedBox(height: AppConstants.spacingSm),
        const Text(
          'Civic Report needs these permissions to let you report issues '
          'accurately. You can change them anytime in Settings.',
          style: AppTextStyles.bodyMedium,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Individual permission card
// ---------------------------------------------------------------------------

class _PermissionCard extends StatelessWidget {
  const _PermissionCard({required this.item, this.status});

  final _PermItem item;
  final PermissionStatus? status;

  @override
  Widget build(BuildContext context) {
    final isGranted = status == PermissionStatus.granted ||
        status == PermissionStatus.limited;
    final isDenied = status == PermissionStatus.permanentlyDenied;

    final Color iconBg = isGranted
        ? AppColors.primaryLight
        : isDenied
            ? const Color(0xFFFEE2E2) // red tint
            : AppColors.background;

    final Color iconColor = isGranted
        ? AppColors.primary
        : isDenied
            ? AppColors.error
            : AppColors.textSecondary;

    return Container(
      padding: const EdgeInsets.all(AppConstants.spacingMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(
          color: isGranted
              ? AppColors.primary.withValues(alpha: 0.3)
              : AppColors.inputBorder,
        ),
      ),
      child: Row(
        children: [
          // Icon circle
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: iconBg,
              shape: BoxShape.circle,
            ),
            child: Icon(item.icon, size: 22, color: iconColor),
          ),

          const SizedBox(width: AppConstants.spacingMd),

          // Text
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.title, style: AppTextStyles.label),
                const SizedBox(height: 2),
                Text(item.description, style: AppTextStyles.bodySmall),
              ],
            ),
          ),

          const SizedBox(width: AppConstants.spacingSm),

          // Status badge
          _StatusBadge(status: status),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({this.status});

  final PermissionStatus? status;

  @override
  Widget build(BuildContext context) {
    if (status == null) return const SizedBox.shrink();

    final isGranted =
        status == PermissionStatus.granted || status == PermissionStatus.limited;
    final isDenied = status == PermissionStatus.permanentlyDenied;

    if (isGranted) {
      return const Icon(
        Icons.check_circle_rounded,
        color: AppColors.success,
        size: 22,
      );
    }

    if (isDenied) {
      return const Icon(
        Icons.cancel_rounded,
        color: AppColors.error,
        size: 22,
      );
    }

    return const SizedBox.shrink();
  }
}
