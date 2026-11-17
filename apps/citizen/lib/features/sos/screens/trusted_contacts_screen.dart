import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_colors_extension.dart';
import '../models/sos_models.dart';
import '../providers/trusted_contacts_provider.dart';
import '../services/sos_text.dart';

/// Up to five people who are texted when the citizen sends an SOS.
///
/// Numbers are typed rather than picked from the address book, so the app
/// needs no contacts permission.
class TrustedContactsScreen extends StatefulWidget {
  const TrustedContactsScreen({super.key});

  @override
  State<TrustedContactsScreen> createState() => _TrustedContactsScreenState();
}

class _TrustedContactsScreenState extends State<TrustedContactsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<TrustedContactsProvider>().load();
    });
  }

  Future<void> _edit([TrustedContact? contact]) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => ChangeNotifierProvider.value(
        value: context.read<TrustedContactsProvider>(),
        child: _ContactForm(contact: contact),
      ),
    );
  }

  Future<void> _remove(TrustedContact contact) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Remove ${contact.name}?'),
        content:
            const Text('They will no longer be texted when you send an SOS.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final error = await context.read<TrustedContactsProvider>().remove(contact);
    if (error != null && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TrustedContactsProvider>();
    final contacts = provider.contacts;

    return Scaffold(
      appBar: AppBar(title: const Text('Trusted Contacts')),
      floatingActionButton: provider.canAddMore
          ? FloatingActionButton.extended(
              onPressed: () => _edit(),
              icon: const Icon(Icons.person_add_alt_1),
              label: const Text('Add contact'),
            )
          : null,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
        children: [
          Text(
            'When you send an SOS, these people get a text with your location '
            'and updates while you move. Up to ${TrustedContactsProvider.maxContacts}.',
            style: context.textStyles.bodyMedium,
          ),
          const SizedBox(height: AppConstants.spacingMd),
          if (provider.errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppConstants.spacingSm),
              child: Text(provider.errorMessage!,
                  style: context.textStyles.bodySmall),
            ),
          if (provider.isLoading && contacts.isEmpty)
            const Center(child: CircularProgressIndicator())
          else if (contacts.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Text(
                'No trusted contacts yet.',
                textAlign: TextAlign.center,
                style: context.textStyles.bodyMedium,
              ),
            ),
          for (final contact in contacts)
            Card(
              margin: const EdgeInsets.only(bottom: AppConstants.spacingSm),
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: context.colors.primaryLight,
                  child: Text(
                    contact.name.characters.first.toUpperCase(),
                    style: TextStyle(color: context.colors.textPrimary),
                  ),
                ),
                title: Text(contact.name),
                subtitle: Text([
                  contact.phone,
                  if (contact.relationship != null) contact.relationship!,
                ].join(' · ')),
                onTap: () => _edit(contact),
                trailing: IconButton(
                  tooltip: 'Remove ${contact.name}',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _remove(contact),
                ),
              ),
            ),
          if (!provider.canAddMore)
            Text(
              "You've added the maximum of ${TrustedContactsProvider.maxContacts} contacts.",
              style: context.textStyles.bodySmall,
            ),
        ],
      ),
    );
  }
}

class _ContactForm extends StatefulWidget {
  const _ContactForm({this.contact});

  final TrustedContact? contact;

  @override
  State<_ContactForm> createState() => _ContactFormState();
}

class _ContactFormState extends State<_ContactForm> {
  final _formKey = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.contact?.name);
  late final _phone = TextEditingController(text: widget.contact?.phone);
  late final _relationship =
      TextEditingController(text: widget.contact?.relationship);
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _relationship.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final provider = context.read<TrustedContactsProvider>();
    final contact = widget.contact;
    final error = contact == null
        ? await provider.add(
            name: _name.text.trim(),
            phone: _phone.text.trim(),
            relationship: _relationship.text.trim(),
          )
        : await provider.update(
            contact,
            name: _name.text.trim(),
            phone: _phone.text.trim(),
            relationship: _relationship.text.trim(),
          );
    if (!mounted) return;
    if (error == null) {
      Navigator.of(context).pop();
    } else {
      setState(() {
        _saving = false;
        _error = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 0, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.contact == null ? 'Add trusted contact' : 'Edit contact',
              style: context.textStyles.label,
            ),
            const SizedBox(height: AppConstants.spacingMd),
            TextFormField(
              key: const ValueKey('contact-name'),
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Name'),
              validator: (value) => (value == null || value.trim().isEmpty)
                  ? 'Enter a name'
                  : null,
            ),
            const SizedBox(height: AppConstants.spacingSm),
            TextFormField(
              key: const ValueKey('contact-phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Phone number',
                hintText: '0803 123 4567',
              ),
              validator: (value) => normalizePhone(value ?? '') == null
                  ? 'Enter a valid phone number, e.g. 0803 123 4567'
                  : null,
            ),
            const SizedBox(height: AppConstants.spacingSm),
            TextFormField(
              key: const ValueKey('contact-relationship'),
              controller: _relationship,
              textCapitalization: TextCapitalization.sentences,
              decoration:
                  const InputDecoration(labelText: 'Relationship (optional)'),
            ),
            if (_error != null) ...[
              const SizedBox(height: AppConstants.spacingSm),
              Text(_error!,
                  style: context.textStyles.bodySmall
                      .copyWith(color: AppColors.error)),
            ],
            const SizedBox(height: AppConstants.spacingMd),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}
