// UI translations for the technician app (en/id). Customer-facing reports
// are generated server-side in English and are NOT driven by this — see
// supabase/functions/complete-service. Service task NAMES are stored in
// English (service_tasks.task_name); these `task.*` entries translate the
// on-screen display only, so reports stay English.
//
// Keys are namespaced by area. Missing keys fall back to English, then to
// the key itself. Interpolation uses {placeholder} tokens.

export const translations = {
  en: {
    // ── common ──
    'common.save': 'Save',
    'common.saving': 'Saving…',
    'common.cancel': 'Cancel',
    'common.next': 'Next',
    'common.back': 'Back',
    'common.done': 'Done',
    'common.skip': 'Skip',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
    'common.close': 'Close',
    'common.optional': 'Optional',
    'common.required': 'Required',

    // ── nav / shell ──
    'nav.profile': 'My Profile',
    'nav.logout': 'Log Out',
    'nav.language': 'Language',

    // ── profile ──
    'profile.title': 'My Profile',
    'profile.name': 'Name',
    'profile.email': 'Email',
    'profile.phone': 'Phone',
    'profile.bio': 'Bio',
    'profile.language': 'Language',
    'profile.changePassword': 'Change Password',
    'profile.newPassword': 'New password',
    'profile.updatePassword': 'Update Password',
    'profile.save': 'Save changes',
    'profile.saved': 'Saved',
    'profile.logout': 'Log Out',
    'profile.photoHint': 'Tap to change photo',
    'profile.backToRunSheet': 'Back to Run Sheet',
    'profile.saveChanges': 'Save Changes',
    'profile.newPasswordLabel': 'New Password',
    'profile.passwordHint': 'At least 6 characters',
    'profile.pwTooShort': 'Password must be at least 6 characters.',
    'profile.pwUpdated': 'Password updated successfully.',
    'profile.pwFailed': 'Failed to update password.',

    // ── service task names (English canonical → display) ──
    'task.Vacuumed': 'Vacuumed',
    'task.Scrubbed water line': 'Scrubbed water line',
    'task.Checked water level': 'Checked water level',
    'task.Emptied pump basket': 'Emptied pump basket',
    'task.Backwash filter': 'Backwash filter',
    'task.Emptied skimmer basket': 'Emptied skimmer basket',
    'task.Checked equipment': 'Checked equipment',
    'task.Checked chlorinator': 'Checked chlorinator',
  },

  id: {
    // ── common ──
    'common.save': 'Simpan',
    'common.saving': 'Menyimpan…',
    'common.cancel': 'Batal',
    'common.next': 'Lanjut',
    'common.back': 'Kembali',
    'common.done': 'Selesai',
    'common.skip': 'Lewati',
    'common.loading': 'Memuat…',
    'common.retry': 'Coba lagi',
    'common.close': 'Tutup',
    'common.optional': 'Opsional',
    'common.required': 'Wajib',

    // ── nav / shell ──
    'nav.profile': 'Profil Saya',
    'nav.logout': 'Keluar',
    'nav.language': 'Bahasa',

    // ── profile ──
    'profile.title': 'Profil Saya',
    'profile.name': 'Nama',
    'profile.email': 'Email',
    'profile.phone': 'Telepon',
    'profile.bio': 'Bio',
    'profile.language': 'Bahasa',
    'profile.changePassword': 'Ubah Kata Sandi',
    'profile.newPassword': 'Kata sandi baru',
    'profile.updatePassword': 'Perbarui Kata Sandi',
    'profile.save': 'Simpan perubahan',
    'profile.saved': 'Tersimpan',
    'profile.logout': 'Keluar',
    'profile.photoHint': 'Ketuk untuk ganti foto',
    'profile.backToRunSheet': 'Kembali ke Daftar Tugas',
    'profile.saveChanges': 'Simpan Perubahan',
    'profile.newPasswordLabel': 'Kata Sandi Baru',
    'profile.passwordHint': 'Minimal 6 karakter',
    'profile.pwTooShort': 'Kata sandi minimal 6 karakter.',
    'profile.pwUpdated': 'Kata sandi berhasil diperbarui.',
    'profile.pwFailed': 'Gagal memperbarui kata sandi.',

    // ── service task names ──
    'task.Vacuumed': 'Disedot (vakum)',
    'task.Scrubbed water line': 'Gosok garis air',
    'task.Checked water level': 'Cek ketinggian air',
    'task.Emptied pump basket': 'Kosongkan keranjang pompa',
    'task.Backwash filter': 'Backwash filter',
    'task.Emptied skimmer basket': 'Kosongkan keranjang skimmer',
    'task.Checked equipment': 'Cek peralatan',
    'task.Checked chlorinator': 'Cek klorinator',
  },
}
