from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ribo_services.audio.music import MusicPlayer, AudioDucker
from ribo_services.audio.timers import TimerService


class AudioComponentTests(unittest.TestCase):
    def test_music_spawn_owns_no_parent_log_descriptor(self):
        process = Mock()
        process.poll.return_value = None
        with patch('ribo_services.audio.music.subprocess.Popen', return_value=process) as spawn, patch('ribo_services.audio.music.time.sleep'):
            player = MusicPlayer()
            result = player.play(station_name='swr3')
            self.assertNotIn('error', result)
            self.assertTrue(spawn.call_args.kwargs['start_new_session'])
            self.assertTrue(spawn.call_args.kwargs['stderr'].closed)

    def test_timer_state_is_testable_without_http_tts_or_audio_playback(self):
        player = MusicPlayer()
        service = TimerService(AudioDucker(player))
        with patch('ribo_services.audio.timers.threading.Timer') as timer:
            result = service.create_timer(name='synthetic', duration_seconds=60)
            self.assertNotIn('error', result)
            self.assertEqual(len(service.list_timers()['timers']), 1)
            service.cancel_timer('synthetic')
            self.assertEqual(service.list_timers()['timers'], [])
            timer.return_value.cancel.assert_called_once()
            service.create_timer(name='pending', duration_seconds=60)
            service.close()
            self.assertEqual(service.list_timers()['timers'], [])
            self.assertEqual(timer.return_value.cancel.call_count, 2)
