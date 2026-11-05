import 'package:image_picker/image_picker.dart';

import 'report_category.dart';
import 'report_location.dart';
import 'report_photo.dart';

class PendingReport {
  const PendingReport({
    required this.id,
    required this.citizenId,
    required this.category,
    required this.photos,
    required this.createdAt,
    this.description,
    this.location,
    this.attempts = 0,
    this.lastError,
  });

  final String id;
  final String citizenId;
  final ReportCategory category;
  final List<ReportPhoto> photos;
  final DateTime createdAt;
  final String? description;
  final ReportLocation? location;
  final int attempts;
  final String? lastError;

  PendingReport failed(String message) => PendingReport(
        id: id,
        citizenId: citizenId,
        category: category,
        photos: photos,
        createdAt: createdAt,
        description: description,
        location: location,
        attempts: attempts + 1,
        lastError: message,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'citizenId': citizenId,
        'category': category.toJson(),
        'photos': [
          for (final photo in photos)
            {
              'path': photo.path,
              'name': photo.name,
              'sizeBytes': photo.sizeBytes,
              'mimeType': photo.mimeType,
              'width': photo.width,
              'height': photo.height,
            }
        ],
        'createdAt': createdAt.toIso8601String(),
        if (description != null) 'description': description,
        if (location != null) 'location': location!.toJson(),
        'attempts': attempts,
        if (lastError != null) 'lastError': lastError,
      };

  factory PendingReport.fromJson(Map<String, dynamic> json) => PendingReport(
        id: json['id'] as String,
        citizenId: json['citizenId'] as String,
        category: ReportCategory.fromJson(
          Map<String, dynamic>.from(json['category'] as Map),
        ),
        photos: (json['photos'] as List<dynamic>).map((value) {
          final photo = Map<String, dynamic>.from(value as Map);
          return ReportPhoto(
            file: XFile(photo['path'] as String),
            name: photo['name'] as String,
            sizeBytes: photo['sizeBytes'] as int,
            mimeType: photo['mimeType'] as String,
            width: photo['width'] as int,
            height: photo['height'] as int,
          );
        }).toList(growable: false),
        createdAt: DateTime.parse(json['createdAt'] as String),
        description: json['description'] as String?,
        location: json['location'] == null
            ? null
            : ReportLocation.fromJson(
                Map<String, dynamic>.from(json['location'] as Map),
              ),
        attempts: json['attempts'] as int? ?? 0,
        lastError: json['lastError'] as String?,
      );
}
