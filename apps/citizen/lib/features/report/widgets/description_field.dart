import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../providers/report_draft_provider.dart';

/// The Description section of the report form.
///
/// Optional: a photo and a category already say what and where. The text is
/// there for the detail a photo cannot carry — how deep the pothole is, whether
/// it is blocking a lane — so the field invites that rather than demanding it.
class DescriptionField extends StatefulWidget {
  const DescriptionField({super.key});

  /// Matches the `description` column, which is `TEXT`, but caps what the
  /// citizen types rather than letting a paste of an essay fail server-side.
  static const int maxLength = 1000;

  @override
  State<DescriptionField> createState() => _DescriptionFieldState();
}

class _DescriptionFieldState extends State<DescriptionField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();

    // Seeded from the provider so the text survives a rebuild of the screen —
    // the draft, not this widget, is the source of truth.
    _controller = TextEditingController(
      text: context.read<ReportDraftProvider>().description,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Watching only the length keeps this widget from rebuilding on every
    // unrelated draft change — the photo strip is the expensive sibling.
    final length = context.select<ReportDraftProvider, int>(
      (d) => d.description.length,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _controller,
          onChanged: context.read<ReportDraftProvider>().setDescription,
          maxLines: 4,
          minLines: 4,
          maxLength: DescriptionField.maxLength,
          textInputAction: TextInputAction.newline,
          keyboardType: TextInputType.multiline,
          style: const TextStyle(
            fontSize: 14,
            color: AppColors.textPrimary,
            height: 1.5,
          ),
          decoration: InputDecoration(
            hintText: 'Provide more details about the issue '
                '(e.g. depth, impact on traffic)…',
            hintStyle: AppTextStyles.bodyMedium,
            filled: true,
            fillColor: AppColors.inputFill,
            // The default counter sits in the field's padding and pushes the
            // layout around; this one is placed below, quietly.
            counterText: '',
            contentPadding: const EdgeInsets.all(AppConstants.spacingMd),
            border: _border(AppColors.inputBorder),
            enabledBorder: _border(AppColors.inputBorder),
            focusedBorder: _border(AppColors.primary, width: 1.5),
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: const EdgeInsets.only(top: AppConstants.spacingXs),
            child: Text(
              '$length / ${DescriptionField.maxLength}',
              style: AppTextStyles.bodySmall,
            ),
          ),
        ),
      ],
    );
  }

  OutlineInputBorder _border(Color color, {double width = 1}) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      borderSide: BorderSide(color: color, width: width),
    );
  }
}
