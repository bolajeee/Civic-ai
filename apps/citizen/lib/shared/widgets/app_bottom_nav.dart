import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';

// ---------------------------------------------------------------------------
// NavTab — the four tabs used throughout the app
// ---------------------------------------------------------------------------

enum NavTab { home, report, history, profile }

// ---------------------------------------------------------------------------
// AppBottomNav
//
// A fully custom bottom navigation bar that matches the Figma design exactly.
//
// Why custom and not BottomNavigationBar?
//   • The Report tab active state needs a small pill container behind its
//     icon, which BottomNavigationBar does not support without hacks.
//   • This gives us full control over spacing, typography, and colours.
//
// Usage:
//   bottomNavigationBar: AppBottomNav(
//     currentTab: NavTab.home,
//     onTabSelected: (tab) { ... },
//   )
// ---------------------------------------------------------------------------

class AppBottomNav extends StatelessWidget {
  const AppBottomNav({
    super.key,
    required this.currentTab,
    required this.onTabSelected,
  });

  final NavTab currentTab;
  final ValueChanged<NavTab> onTabSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: AppColors.divider, width: 1),
        ),
      ),
      // SafeArea handles the iOS home-indicator bottom inset
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 60,
          child: Row(
            children: [
              _NavItem(
                icon: Icons.home_outlined,
                activeIcon: Icons.home_rounded,
                label: 'Home',
                isActive: currentTab == NavTab.home,
                onTap: () => onTabSelected(NavTab.home),
              ),
              _NavItem(
                icon: Icons.add_circle_outline_rounded,
                activeIcon: Icons.add_circle_outline_rounded,
                label: 'Report',
                isActive: currentTab == NavTab.report,
                onTap: () => onTabSelected(NavTab.report),
                // The Report tab shows a pill-shaped tinted container when active
                useActivePill: true,
              ),
              _NavItem(
                icon: Icons.format_list_bulleted_rounded,
                activeIcon: Icons.format_list_bulleted_rounded,
                label: 'History',
                isActive: currentTab == NavTab.history,
                onTap: () => onTabSelected(NavTab.history),
              ),
              _NavItem(
                icon: Icons.person_outline_rounded,
                activeIcon: Icons.person_rounded,
                label: 'Profile',
                isActive: currentTab == NavTab.profile,
                onTap: () => onTabSelected(NavTab.profile),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _NavItem — a single tab in the bottom nav
// ---------------------------------------------------------------------------

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.isActive,
    required this.onTap,
    this.useActivePill = false,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  /// If true, wraps the active icon in a light-green rounded pill container.
  /// Used by the Report tab to match the Figma active state.
  final bool useActivePill;

  @override
  Widget build(BuildContext context) {
    final Color color =
        isActive ? AppColors.primary : AppColors.textSecondary;

    final Widget iconWidget = Icon(
      isActive ? activeIcon : icon,
      size: 24,
      color: color,
    );

    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Active Report tab gets a pill container; all others just the icon
            if (isActive && useActivePill)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: iconWidget,
              )
            else
              iconWidget,

            const SizedBox(height: 4),

            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                color: color,
                height: 1.0,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
