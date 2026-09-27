import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/widgets/app_bottom_nav.dart';
import '../../auth/providers/auth_provider.dart';
import '../../report/models/relative_time.dart';
import '../../report/models/submitted_report.dart';
import '../../report/providers/report_history_provider.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _darkMode = false;

  @override
  void initState() {
    super.initState();

    // Deferred to after the first frame — `load()` notifies its listeners, and
    // the provider sits above this route. Usually a no-op, because Home has
    // already fetched the list; it covers the cold start that lands here.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final history = context.read<ReportHistoryProvider>();
      if (!history.hasLoaded) history.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final history = context.watch<ReportHistoryProvider>();
    final email = user?.email ?? 'adaeze@domain.ng';
    final localPart = email.split('@').first;
    final name = _displayName(email);
    final initials = localPart.substring(0, localPart.length.clamp(0, 2)).toUpperCase();
    final total = history.reports.length;
    final resolved =
        history.reports.where((r) => r.status == ReportStatus.resolved).length;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 28, 20, 12),
                children: [
                  CircleAvatar(radius: 42, backgroundColor: AppColors.primary, child: Text(initials, style: const TextStyle(fontSize: 24, color: AppColors.surface, fontWeight: FontWeight.w700))),
                  const SizedBox(height: 14),
                  Center(child: Text(name, style: AppTextStyles.heading2)),
                  const SizedBox(height: 4),
                  Center(child: Text(email, style: AppTextStyles.bodyMedium)),
                  const SizedBox(height: 8),
                  const Row(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.location_on_outlined, size: 20, color: AppColors.primary), SizedBox(width: 4), Text('Lagos, Nigeria', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700))]),
                  const SizedBox(height: 26),
                  _StatsCard(total: total, resolved: resolved),
                  const SizedBox(height: 30),
                  _SettingsCard(darkMode: _darkMode, onDarkModeChanged: (value) => setState(() => _darkMode = value)),
                  const SizedBox(height: 4),
                  const Center(child: Text('v1.0.4 (Beta)', style: TextStyle(color: AppColors.textSecondary, fontSize: 13))),
                ],
              ),
            ),
            AppBottomNav(
              currentTab: NavTab.profile,
              onTabSelected: (tab) {
                switch (tab) {
                  case NavTab.home:
                    context.go(AppRoutes.home);
                  case NavTab.report:
                    context.go(AppRoutes.report);
                  case NavTab.history:
                    context.go(AppRoutes.history);
                  case NavTab.profile:
                    break;
                }
              },
            ),
          ],
        ),
      ),
    );
  }

  static String _displayName(String email) {
    final local = email.split('@').first;
    final words = local.split(RegExp(r'[._-]')).where((word) => word.isNotEmpty);
    final formatted = words.map((word) => '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}').join(' ');
    return formatted.isEmpty ? 'Adaeze Okafor' : formatted;
  }
}

class _StatsCard extends StatelessWidget {
  const _StatsCard({required this.total, required this.resolved});

  final int total;
  final int resolved;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 92,
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppConstants.radiusMd), border: Border.all(color: AppColors.inputBorder)),
      // Impact Score has no scoring model behind it yet. It renders [kNoValue]
      // rather than the placeholder number it used to show — "94" looked
      // exactly like a real score.
      child: Row(children: [_stat('$total', 'Reports'), _divider(), _stat('$resolved', 'Resolved'), _divider(), _stat(kNoValue, 'Impact Score', accent: true)]),
    );
  }

  Widget _stat(String value, String label, {bool accent = false}) => Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Text(value, style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: accent ? AppColors.primary : AppColors.textPrimary)), const SizedBox(height: 5), Text(label, style: AppTextStyles.bodyMedium)]));
  Widget _divider() => Container(height: 44, width: 1, color: AppColors.inputBorder);
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.darkMode, required this.onDarkModeChanged});
  final bool darkMode;
  final ValueChanged<bool> onDarkModeChanged;

  @override
  Widget build(BuildContext context) => Container(
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppConstants.radiusLg)),
    child: Column(children: [
      const _SettingsRow(icon: Icons.person_outline, label: 'Edit Profile'),
      const _SettingsRow(icon: Icons.notifications_none_rounded, label: 'Notifications'),
      const _SettingsRow(icon: Icons.language_rounded, label: 'Language'),
      _SettingsRow(icon: Icons.dark_mode_outlined, label: 'Dark Mode', trailing: Switch(value: darkMode, onChanged: onDarkModeChanged)),
      const _SettingsRow(icon: Icons.help_outline_rounded, label: 'Help & Support'),
      const _SettingsRow(icon: Icons.info_outline_rounded, label: 'About'),
      _SettingsRow(icon: Icons.logout_rounded, label: 'Log Out', destructive: true, onTap: () => context.read<AuthProvider>().logout()),
    ]),
  );
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({required this.icon, required this.label, this.trailing, this.destructive = false, this.onTap});
  final IconData icon;
  final String label;
  final Widget? trailing;
  final bool destructive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = destructive ? AppColors.error : AppColors.textPrimary;
    return InkWell(
      onTap: onTap,
      child: Container(
        height: 68,
        padding: const EdgeInsets.symmetric(horizontal: 28),
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.inputBorder))),
        child: Row(children: [Icon(icon, color: color, size: 26), const SizedBox(width: 24), Expanded(child: Text(label, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: color))), trailing ?? const Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary, size: 28)]),
      ),
    );
  }
}

