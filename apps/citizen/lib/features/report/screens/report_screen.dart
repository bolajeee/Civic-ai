import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/widgets/app_bottom_nav.dart';
import '../../../shared/widgets/app_text_field.dart';
import '../../../shared/widgets/primary_button.dart';

// ---------------------------------------------------------------------------
// Category data model
//
// IMPORTANT: This is the report *category* — the type of civic issue being
// reported. It is NOT the citizen's evidence photo. The photo upload section
// below is separate and distinct.
// ---------------------------------------------------------------------------

class _CategoryItem {
  const _CategoryItem({
    required this.title,
    required this.icon,
  });

  final String title;
  final IconData icon;
}

/// Each icon is chosen to clearly represent the specific category type.
/// Pothole/road → construction/road icon
/// Flooding     → flood/water icon
/// Streetlight  → lightbulb icon
/// Waste        → delete/bin icon
/// Water Leak   → water drop / pipe icon
/// Other        → help circle icon
const List<_CategoryItem> _categories = [
  _CategoryItem(title: 'Pothole',     icon: Icons.image_outlined),
  _CategoryItem(title: 'Flooding',    icon: Icons.umbrella_outlined),
  _CategoryItem(title: 'Streetlight', icon: Icons.wb_sunny_outlined),
  _CategoryItem(title: 'Waste',       icon: Icons.delete_outline_rounded),
  _CategoryItem(title: 'Water Leak',  icon: Icons.water_drop_outlined),
  _CategoryItem(title: 'Other',       icon: Icons.error_outline_rounded),
];

// ---------------------------------------------------------------------------
// ReportScreen
// ---------------------------------------------------------------------------

class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key});

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  int _selectedCategoryIndex = 0;
  String? _selectedPhotoSource;

  late final TextEditingController _locationController;
  late final TextEditingController _descriptionController;

  @override
  void initState() {
    super.initState();
    _locationController = TextEditingController(
      text: 'Herbert Macaulay Way, Yaba, Lagos',
    );
    _descriptionController = TextEditingController();
  }

  @override
  void dispose() {
    _locationController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickLocation() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _LocationPickerSheet(),
    );
    if (!mounted || choice == null) return;
    setState(() {
      _locationController.text = choice == 'current'
          ? 'Current location detected'
          : 'Location selected on map';
    });
  }

  Future<void> _pickPhoto() async {
    final source = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => const _PhotoPickerSheet(),
    );
    if (!mounted || source == null) return;
    setState(() => _selectedPhotoSource = source);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      // -----------------------------------------------------------------------
      // AppBar
      // -----------------------------------------------------------------------
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go(AppRoutes.home);
            }
          },
        ),
        title: const Text('Report an Issue', style: AppTextStyles.heading2),
      ),
      // -----------------------------------------------------------------------
      // Body
      // -----------------------------------------------------------------------
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(
            horizontal: AppConstants.spacingLg,
            vertical: AppConstants.spacingMd,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ---------------------------------------------------------------
              // Select Category
              // ---------------------------------------------------------------
              const Text('Select Category', style: AppTextStyles.label),
              const SizedBox(height: AppConstants.spacingSm),
              _CategoryGrid(
                categories: _categories,
                selectedIndex: _selectedCategoryIndex,
                onSelect: (i) => setState(() => _selectedCategoryIndex = i),
              ),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Location
              // ---------------------------------------------------------------
              const Text('Location', style: AppTextStyles.label),
              const SizedBox(height: AppConstants.spacingSm),
              AppTextField(
                controller: _locationController,
                hint: 'Enter issue location',
                readOnly: true,
                onTap: _pickLocation,
                prefixIcon: const Icon(
                  Icons.location_on_outlined,
                  color: AppColors.textSecondary,
                ),
              ),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Add Photo — evidence upload area
              //
              // This is the CITIZEN'S EVIDENCE PHOTO, not the category icon.
              // The camera/upload icon here represents the action of taking or
              // selecting a photo to attach as proof of the issue.
              // ---------------------------------------------------------------
              const Text('Add Photo', style: AppTextStyles.label),
              const SizedBox(height: AppConstants.spacingSm),
              _PhotoUploadArea(
                selectedSource: _selectedPhotoSource,
                onTap: _pickPhoto,
              ),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Description
              // ---------------------------------------------------------------
              const Text('Description', style: AppTextStyles.label),
              const SizedBox(height: AppConstants.spacingSm),
              TextFormField(
                controller: _descriptionController,
                maxLines: 4,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.textPrimary,
                ),
                decoration: const InputDecoration(
                  hintText:
                      'Provide more details about the issue '
                      '(e.g. depth, impact on traffic)...',
                  alignLabelWithHint: true,
                ),
              ),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Submit
              // ---------------------------------------------------------------
              PrimaryButton(
                label: 'Submit Report',
                onPressed: () {
                  // TODO(phase-3): wire to report submission API
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Report submission will be enabled in an upcoming update.',
                      ),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                },
              ),

              const SizedBox(height: AppConstants.spacingMd),
            ],
          ),
        ),
      ),
      // -----------------------------------------------------------------------
      // Bottom navigation — shared AppBottomNav (Report tab active)
      // -----------------------------------------------------------------------
      bottomNavigationBar: AppBottomNav(
        currentTab: NavTab.report,
        onTabSelected: (tab) {
          switch (tab) {
            case NavTab.home:
              context.go(AppRoutes.home);
            case NavTab.report:
              break;
            case NavTab.history:
              context.go(AppRoutes.history);
            case NavTab.profile:
              context.go(AppRoutes.profile);
          }
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _CategoryGrid — 2-row × 3-column grid of category cards
// ---------------------------------------------------------------------------

class _CategoryGrid extends StatelessWidget {
  const _CategoryGrid({
    required this.categories,
    required this.selectedIndex,
    required this.onSelect,
  });

  final List<_CategoryItem> categories;
  final int selectedIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Row 1: indices 0–2
        Row(
          children: [
            for (int i = 0; i < 3; i++) ...[
              if (i > 0) const SizedBox(width: AppConstants.spacingSm),
              Expanded(
                child: _CategoryCard(
                  item: categories[i],
                  isSelected: selectedIndex == i,
                  onTap: () => onSelect(i),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: AppConstants.spacingSm),
        // Row 2: indices 3–5
        Row(
          children: [
            for (int i = 3; i < 6; i++) ...[
              if (i > 3) const SizedBox(width: AppConstants.spacingSm),
              Expanded(
                child: _CategoryCard(
                  item: categories[i],
                  isSelected: selectedIndex == i,
                  onTap: () => onSelect(i),
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// _CategoryCard — individual selectable category tile
// ---------------------------------------------------------------------------

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  final _CategoryItem item;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color borderColor =
        isSelected ? AppColors.primary : AppColors.inputBorder;
    final Color bgColor =
        isSelected ? AppColors.primaryLight : AppColors.surface;
    final Color contentColor =
        isSelected ? AppColors.primary : AppColors.textPrimary;

    return Material(
      color: bgColor,
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        splashColor: AppColors.primaryLight,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 4),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
            border: Border.all(
              color: borderColor,
              width: isSelected ? 1.5 : 1.0,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(item.icon, size: 24, color: contentColor),
              const SizedBox(height: 6),
              Text(
                item.title,
                textAlign: TextAlign.center,
                style: AppTextStyles.bodySmall.copyWith(
                  color: contentColor,
                  fontWeight:
                      isSelected ? FontWeight.w600 : FontWeight.w500,
                  fontSize: 12,
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
// _PhotoUploadArea
//
// Dashed-border upload box for the citizen's evidence photo.
// The camera icon here represents the UPLOAD ACTION, not the report category.
// ---------------------------------------------------------------------------

class _PhotoUploadArea extends StatelessWidget {
  const _PhotoUploadArea({required this.selectedSource, required this.onTap});

  final String? selectedSource;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primaryLight.withValues(alpha: 0.35),
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        child: Container(
          width: double.infinity,
          height: 104,
          padding: const EdgeInsets.all(AppConstants.spacingMd),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
            border: Border.all(color: AppColors.primary.withValues(alpha: 0.45)),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: const BoxDecoration(
                  color: AppColors.surface,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  selectedSource == null
                      ? Icons.add_a_photo_outlined
                      : Icons.image_outlined,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: AppConstants.spacingMd),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      selectedSource == null ? 'Add Photo' : 'Photo selected',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      selectedSource == null
                          ? 'Add evidence of the issue'
                          : '$selectedSource preview placeholder',
                      style: AppTextStyles.bodySmall,
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

class _LocationPickerSheet extends StatelessWidget {
  const _LocationPickerSheet();

  @override
  Widget build(BuildContext context) {
    return _PickerSheet(
      title: 'Choose location',
      children: [
        _PickerOption(
          icon: Icons.my_location_rounded,
          title: 'Use Current Location',
          subtitle: 'Use your device location',
          onTap: () => Navigator.pop(context, 'current'),
        ),
        _PickerOption(
          icon: Icons.map_outlined,
          title: 'Choose on Map',
          subtitle: 'Select a point on the map',
          onTap: () => Navigator.pop(context, 'map'),
        ),
      ],
    );
  }
}

class _PhotoPickerSheet extends StatelessWidget {
  const _PhotoPickerSheet();

  @override
  Widget build(BuildContext context) {
    return _PickerSheet(
      title: 'Add photo',
      children: [
        _PickerOption(
          icon: Icons.camera_alt_outlined,
          title: 'Take Photo',
          subtitle: 'Use your camera',
          onTap: () => Navigator.pop(context, 'Camera'),
        ),
        _PickerOption(
          icon: Icons.photo_library_outlined,
          title: 'Choose from Gallery',
          subtitle: 'Select an existing photo',
          onTap: () => Navigator.pop(context, 'Gallery'),
        ),
        _PickerOption(
          icon: Icons.folder_outlined,
          title: 'Browse Files',
          subtitle: 'Choose an image file',
          onTap: () => Navigator.pop(context, 'Files'),
        ),
      ],
    );
  }
}

class _PickerSheet extends StatelessWidget {
  const _PickerSheet({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.inputBorder,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(title, style: AppTextStyles.heading2),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _PickerOption extends StatelessWidget {
  const _PickerOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(vertical: 6),
      leading: Container(
        width: 44,
        height: 44,
        decoration: const BoxDecoration(
          color: AppColors.primaryLight,
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: AppColors.primary),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: AppTextStyles.bodySmall),
      trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
      onTap: onTap,
    );
  }
}

