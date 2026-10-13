import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/providers/app_settings_provider.dart';

class LanguageScreen extends StatelessWidget {
  const LanguageScreen({super.key});

  static const languages = {
    'en': 'English',
    'ha': 'Hausa',
    'ig': 'Igbo',
    'yo': 'Yoruba'
  };

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettingsProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Language')),
      body: ListView(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
            child: Text(
                'Choose your preferred language for future civic updates. App translations are being prepared.'),
          ),
          ...languages.entries.map((entry) => ListTile(
                title: Text(entry.value),
                trailing: settings.languageCode == entry.key
                    ? Icon(Icons.check_rounded,
                        color: Theme.of(context).colorScheme.primary)
                    : null,
                onTap: () => settings.setLanguage(entry.key),
              )),
        ],
      ),
    );
  }
}
