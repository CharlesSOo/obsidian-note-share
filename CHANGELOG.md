# Changelog

## [1.1.0] - 2024-12-29

### Added
- **Parallel uploads**: Images and linked pages now upload concurrently (max 20)
- **WebP compression**: Images auto-convert to WebP at 85% quality (~30-50% smaller)
- **Auto-delete**: Optional retention period for shared notes (configurable in settings)

### Changed
- Streamlined settings UI (2 sections instead of 5)
- Improved README with BRAT installation instructions
- Context menu now shows single option when "Include linked notes" is enabled
- Reduced console log noise (only logs for shared files)

### Fixed
- Image filename encoding issues
- Sync timing and delays

## [1.0.0] - 2024-12-28

### Added
- Initial release
- Share notes via permanent URLs
- Auto-sync when editing shared notes
- Theme sync (captures Obsidian colors)
- Image upload support (![[image]] embeds)
- Linked notes sharing ([[wikilinks]])
- Sidebar for managing shared notes
