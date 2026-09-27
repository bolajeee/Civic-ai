import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/router/app_router.dart';
import '../../../features/auth/providers/auth_provider.dart';
import '../../../shared/data/mock_reports.dart';
import '../../../shared/widgets/app_bottom_nav.dart';
import '../../../shared/widgets/report_card.dart';

// ---------------------------------------------------------------------------
// HomeScreen
// ---------------------------------------------------------------------------

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final TextEditingController _searchController;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final String initials = _initials(user?.email ?? '');
    final String firstName = _firstName(user?.email ?? '');
    final query = _query.trim().toLowerCase();
    final reports = kMockReports.where((report) {
      return query.isEmpty ||
          report.title.toLowerCase().contains(query) ||
          report.category.toLowerCase().contains(query) ||
          report.location.toLowerCase().contains(query);
    }).take(3).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Stack(
          children: [
            // ----------------------------------------------------------------
            // Scrollable content
            // ----------------------------------------------------------------
            CustomScrollView(
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.only(
                    left: 20,
                    right: 20,
                    top: 20,
                    bottom: 100, // clears FAB + bottom nav
                  ),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate([
                      _Header(initials: initials, firstName: firstName),
                      const SizedBox(height: 20),
                      _SearchBar(
                        controller: _searchController,
                        onChanged: (value) => setState(() => _query = value),
                      ),
                      const SizedBox(height: 20),
                      const _StatsRow(),
                      const SizedBox(height: 24),
                      _SectionHeader(
                        title: 'Recent Reports',
                        actionLabel: 'View All',
                        onAction: () => context.go(AppRoutes.history),
                      ),
                      const SizedBox(height: 12),
                      // Show only the 3 most recent reports on Home
                      ...reports.map(
                        (report) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: ReportCard(
                            data: report,
                            onTap: () => context.push(
                              AppRoutes.reportDetails.replaceFirst(':id', report.id),
                            ),
                          ),
                        ),
                      ),
                      if (reports.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 32),
                          child: Center(child: Text('No reports match your search.')),
                        ),
                    ]),
                  ),
                ),
              ],
            ),

            // ----------------------------------------------------------------
            // Floating "+ Report Issue" pill button — bottom-right
            // ----------------------------------------------------------------
            Positioned(
              right: 20,
              bottom: 16,
              child: _ReportFab(
                onTap: () => context.go(AppRoutes.report),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: AppBottomNav(
        currentTab: NavTab.home,
        onTabSelected: (tab) {
          switch (tab) {
            case NavTab.home:
              break;
            case NavTab.report:
              context.go(AppRoutes.report);
            case NavTab.history:
              context.go(AppRoutes.history);
            case NavTab.profile:
              context.go(AppRoutes.profile);
          }
        },
      ),
    );
  }

  static String _initials(String email) {
    final local = email.split('@').first;
    final parts = local.split(RegExp(r'[.\-_]'));
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (local.length >= 2) {
      return (local[0] + local[local.length - 1]).toUpperCase();
    }
    return local.toUpperCase();
  }

  static String _firstName(String email) {
    if (email.isEmpty) return 'there';
    final local = email.split('@').first;
    final parts = local.split(RegExp(r'[.\-_]'));
    final name = parts.first;
    if (name.isEmpty) return 'there';
    return name[0].toUpperCase() + name.substring(1).toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// _Header — avatar + greeting + notification bell
// ---------------------------------------------------------------------------

class _Header extends StatelessWidget {
  const _Header({required this.initials, required this.firstName});

  final String initials;
  final String firstName;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 42,
          height: 42,
          decoration: const BoxDecoration(
            color: AppColors.primary,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            initials,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: AppColors.surface,
              height: 1.0,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Hello, $firstName 👋',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                  height: 1.2,
                ),
              ),
              const SizedBox(height: 2),
              const Text(
                'Ikeja, Lagos',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w400,
                  color: AppColors.textSecondary,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppColors.surface,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.inputBorder),
          ),
          child: const Icon(
            Icons.notifications_outlined,
            size: 20,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// _SearchBar
// ---------------------------------------------------------------------------

class _SearchBar extends StatelessWidget {
  const _SearchBar({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: AppColors.inputBorder),
      ),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        textInputAction: TextInputAction.search,
        style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
        decoration: const InputDecoration(
          hintText: 'Search reports by title, category or location...',
          prefixIcon: Icon(Icons.search_rounded, color: AppColors.textSecondary),
          border: InputBorder.none,
          contentPadding: EdgeInsets.symmetric(vertical: 14),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _StatsRow — three tappable stat cards
// ---------------------------------------------------------------------------

class _StatsRow extends StatelessWidget {
  const _StatsRow();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            iconData: Icons.description_outlined,
            iconColor: AppColors.primary,
            iconBgColor: AppColors.primaryLight,
            value: '12',
            label: 'Submitted',
            // All reports
            onTap: () => context.go(AppRoutes.history),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            iconData: Icons.check_circle_outline_rounded,
            iconColor: AppColors.primary,
            iconBgColor: AppColors.primaryLight,
            value: '8',
            label: 'Resolved',
            // Pre-filtered to Resolved
            onTap: () => context.go(
              '${AppRoutes.history}?filter=resolved',
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            iconData: Icons.access_time_rounded,
            iconColor: AppColors.statusPendingIcon,
            iconBgColor: AppColors.statusPendingBg,
            value: '4',
            label: 'Pending',
            // Pre-filtered to Pending
            onTap: () => context.go(
              '${AppRoutes.history}?filter=pending',
            ),
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.iconData,
    required this.iconColor,
    required this.iconBgColor,
    required this.value,
    required this.label,
    this.onTap,
  });

  final IconData iconData;
  final Color iconColor;
  final Color iconBgColor;
  final String value;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        splashColor: AppColors.primaryLight,
        highlightColor: AppColors.primaryLight.withValues(alpha: 0.5),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
            border: Border.all(color: AppColors.divider),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: iconBgColor,
                  shape: BoxShape.circle,
                ),
                child: Icon(iconData, size: 18, color: iconColor),
              ),
              const SizedBox(height: 8),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                  height: 1.1,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _SectionHeader — title + action link row
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.actionLabel,
    required this.onAction,
  });

  final String title;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
            height: 1.2,
          ),
        ),
        GestureDetector(
          onTap: onAction,
          child: const Text(
            'View All',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.primary,
              height: 1.2,
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// _ReportFab — animated "+ Report Issue" floating pill button
//
// Behaviour:
//   • Tap/press  → scale to 0.96 (natural pressed feel on all platforms)
//   • Hover      → scale to 1.03, stronger shadow (web/desktop only)
//   • All animations use 150 ms ease-in-out
// ---------------------------------------------------------------------------

class _ReportFab extends StatefulWidget {
  const _ReportFab({required this.onTap});

  final VoidCallback onTap;

  @override
  State<_ReportFab> createState() => _ReportFabState();
}

class _ReportFabState extends State<_ReportFab> {
  bool _hovered = false;
  bool _pressed = false;

  double get _scale {
    if (_pressed) return 0.96;
    if (_hovered) return 1.03;
    return 1.0;
  }

  List<BoxShadow> get _shadows {
    if (_hovered && !_pressed) {
      return const [
        BoxShadow(
          color: Color(0x4D1A7A3C), // primary ~30% — stronger on hover
          blurRadius: 18,
          offset: Offset(0, 6),
        ),
      ];
    }
    return const [
      BoxShadow(
        color: Color(0x331A7A3C), // primary ~20% — default
        blurRadius: 12,
        offset: Offset(0, 4),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    Widget fab = AnimatedScale(
      scale: _scale,
      duration: const Duration(milliseconds: 150),
      curve: Curves.easeInOut,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeInOut,
        height: 50,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        decoration: BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(AppConstants.radiusButton),
          boxShadow: _shadows,
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.add_rounded, size: 20, color: AppColors.surface),
            SizedBox(width: 6),
            Text(
              'Report Issue',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: AppColors.surface,
                height: 1.0,
              ),
            ),
          ],
        ),
      ),
    );

    // Wrap with MouseRegion only on web/desktop — no-op on mobile
    if (kIsWeb) {
      fab = MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _hovered = true),
        onExit: (_) => setState(() => _hovered = false),
        child: fab,
      );
    }

    return GestureDetector(
      onTap: widget.onTap,
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      child: fab,
    );
  }
}
