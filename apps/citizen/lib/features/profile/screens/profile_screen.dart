import '../../../core/theme/app_colors_extension.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/router/app_router.dart';
import '../../../core/providers/app_settings_provider.dart';
import '../../../shared/widgets/app_bottom_nav.dart';
import '../../auth/providers/auth_provider.dart';
import '../../report/models/relative_time.dart';
import '../../report/providers/report_summary_provider.dart';
import '../../report/providers/report_history_provider.dart';
import '../../report/widgets/report_summary_status.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  @override
  void initState() {
    super.initState();

    // Refresh after mounting so counts reflect changes since the last visit.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<ReportSummaryProvider>().refresh();
      final history = context.read<ReportHistoryProvider>();
      if (!history.hasRecentLoaded) history.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final summary = context.watch<ReportSummaryProvider>().summary;
    final history = context.watch<ReportHistoryProvider>();
    final settings = context.watch<AppSettingsProvider>();
    final email = user?.email ?? '';
    final name = _displayName(user?.fullName, email);
    final initials = _initials(name);
    String? location;
    for (final report in history.recentReports) {
      if (report.location != null) {
        location = report.location!.displayLabel;
        break;
      }
    }
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: RefreshIndicator(
                onRefresh: () =>
                    context.read<ReportSummaryProvider>().refresh(),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 28, 20, 12),
                  children: [
                    CircleAvatar(
                        radius: 42,
                        backgroundColor: context.colors.primary,
                        child: Text(initials,
                            style: TextStyle(
                                fontSize: 24,
                                color: context.colors.surface,
                                fontWeight: FontWeight.w700))),
                    const SizedBox(height: 14),
                    Center(
                      child: Text(
                        name,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Center(
                        child:
                            Text(email, style: context.textStyles.bodyMedium)),
                    const SizedBox(height: 8),
                    Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(Icons.location_on_outlined,
                          size: 20, color: context.colors.primary),
                      const SizedBox(width: 4),
                      Flexible(
                          child: Text(location ?? 'No report location yet',
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  color: context.colors.primary,
                                  fontWeight: FontWeight.w700)))
                    ]),
                    const SizedBox(height: 26),
                    _StatsCard(
                        total: summary?.total,
                        resolved: summary?.resolved,
                        impactScore: summary?.impactScore),
                    const ReportSummaryStatus(),
                    const SizedBox(height: 30),
                    _SettingsCard(
                        themeMode: settings.themeMode,
                        onThemeModeChanged: settings.setThemeMode),
                    const SizedBox(height: 4),
                    FutureBuilder<PackageInfo>(
                      future: PackageInfo.fromPlatform(),
                      builder: (_, snapshot) => Center(
                        child: Text(
                          snapshot.hasData
                              ? 'v${snapshot.data!.version} (${snapshot.data!.buildNumber})'
                              : 'Version…',
                          style: TextStyle(
                              color: context.colors.textSecondary,
                              fontSize: 13),
                        ),
                      ),
                    ),
                  ],
                ),
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

  static String _displayName(String? fullName, String email) {
    if (fullName != null && fullName.trim().isNotEmpty) return fullName.trim();
    final local = email.split('@').first;
    final words =
        local.split(RegExp(r'[._-]')).where((word) => word.isNotEmpty);
    final formatted = words
        .map((word) =>
            '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}')
        .join(' ');
    return formatted.isEmpty ? 'Adaeze Okafor' : formatted;
  }

  static String _initials(String name) {
    final parts =
        name.split(RegExp(r'\s+')).where((part) => part.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return (parts.length == 1
            ? parts.first.substring(0, parts.first.length.clamp(0, 2))
            : '${parts.first[0]}${parts.last[0]}')
        .toUpperCase();
  }
}

class _StatsCard extends StatelessWidget {
  const _StatsCard(
      {required this.total, required this.resolved, required this.impactScore});

  final int? total;
  final int? resolved;
  final int? impactScore;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 92,
      decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(AppConstants.radiusMd),
          border: Border.all(color: context.colors.inputBorder)),
      // Impact Score has no scoring model behind it yet. It renders [kNoValue]
      // rather than the placeholder number it used to show — "94" looked
      // exactly like a real score.
      child: Row(children: [
        _stat(context, total?.toString() ?? kNoValue, 'Reports'),
        _divider(context),
        _stat(context, resolved?.toString() ?? kNoValue, 'Resolved'),
        _divider(context),
        _stat(context, impactScore?.toString() ?? kNoValue, 'Impact Score',
            accent: true)
      ]),
    );
  }

  Widget _stat(BuildContext context, String value, String label,
          {bool accent = false}) =>
      Expanded(
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(value,
            style: TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                color: accent
                    ? context.colors.primary
                    : Theme.of(context).colorScheme.onSurface)),
        const SizedBox(height: 5),
        Text(label, style: context.textStyles.bodyMedium)
      ]));
  Widget _divider(BuildContext context) =>
      Container(height: 44, width: 1, color: context.colors.inputBorder);
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard(
      {required this.themeMode, required this.onThemeModeChanged});
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;

  static String _themeLabel(ThemeMode m) => switch (m) {
        ThemeMode.system => 'System',
        ThemeMode.light => 'Light',
        ThemeMode.dark => 'Dark',
      };

  Future<void> _pickTheme(BuildContext context) async {
    final picked = await showDialog<ThemeMode>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Appearance'),
        children: [
          for (final m in ThemeMode.values)
            ListTile(
              title: Text(_themeLabel(m)),
              subtitle: m == ThemeMode.system
                  ? const Text('Match device setting')
                  : null,
              trailing: m == themeMode ? const Icon(Icons.check_rounded) : null,
              onTap: () => Navigator.pop(ctx, m),
            ),
        ],
      ),
    );
    if (picked != null) onThemeModeChanged(picked);
  }

  @override
  Widget build(BuildContext context) => Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(AppConstants.radiusLg)),
        child: Column(children: [
          _SettingsRow(
              icon: Icons.person_outline,
              label: 'Edit Profile',
              onTap: () => context.push(AppRoutes.editProfile)),
          _SettingsRow(
              icon: Icons.notifications_none_rounded,
              label: 'Notifications',
              onTap: () => context.push(AppRoutes.notifications)),
          _SettingsRow(
              icon: Icons.language_rounded,
              label: 'Language',
              onTap: () => context.push(AppRoutes.language)),
          _SettingsRow(
              icon: Icons.dark_mode_outlined,
              label: 'Appearance',
              trailing: Text(_themeLabel(themeMode),
                  style: context.textStyles.bodyMedium),
              onTap: () => _pickTheme(context)),
          _SettingsRow(
              icon: Icons.help_outline_rounded,
              label: 'Help & Support',
              onTap: () => context.push(AppRoutes.helpSupport)),
          _SettingsRow(
              icon: Icons.info_outline_rounded,
              label: 'About',
              onTap: () => context.push(AppRoutes.about)),
          _SettingsRow(
              icon: Icons.logout_rounded,
              label: 'Log Out',
              destructive: true,
              onTap: () => context.read<AuthProvider>().logout()),
        ]),
      );
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow(
      {required this.icon,
      required this.label,
      this.trailing,
      this.destructive = false,
      this.onTap});
  final IconData icon;
  final String label;
  final Widget? trailing;
  final bool destructive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color =
        destructive ? AppColors.error : Theme.of(context).colorScheme.onSurface;
    return InkWell(
      onTap: onTap,
      child: Container(
        height: 68,
        padding: const EdgeInsets.symmetric(horizontal: 28),
        decoration: BoxDecoration(
            border:
                Border(bottom: BorderSide(color: context.colors.inputBorder))),
        child: Row(children: [
          Icon(icon, color: color, size: 26),
          const SizedBox(width: 24),
          Expanded(
              child: Text(label,
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: color))),
          trailing ??
              Icon(Icons.chevron_right_rounded,
                  color: context.colors.textSecondary, size: 28)
        ]),
      ),
    );
  }
}
