"""Configured radio catalog shared by the player and HTTP API."""
RADIO_STATIONS = {
    # Kinder
    "radio teddy": "https://irmedia.streamabc.net/irm-rtlive-mp3-192-772966", # geht nicht

    # Bundesweit / Öffentlich-Rechtlich
    "deutschlandfunk": "https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3", # geht
    "dlf kultur": "https://st02.sslstream.dlf.de/dlf/02/128/mp3/stream.mp3", # geht
    "dlf nova": "https://st03.sslstream.dlf.de/dlf/03/128/mp3/stream.mp3", # geht

    # WDR (NRW)
    "1live": "https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/256/stream.mp3", # geht nicht 
    "wdr2": "https://wdr-wdr2-rheinland.icecastssl.wdr.de/wdr/wdr2/rheinland/mp3/256/stream.mp3", # geht nicht 
    "wdr3": "https://wdr-wdr3-live.icecastssl.wdr.de/wdr/wdr3/live/mp3/256/stream.mp3", # geht
    "wdr4": "https://wdr-wdr4-live.icecastssl.wdr.de/wdr/wdr4/live/mp3/256/stream.mp3",# geht nicht 
    "wdr5": "https://wdr-wdr5-live.icecastssl.wdr.de/wdr/wdr5/live/mp3/256/stream.mp3",# geht nicht 
    "1live diggi": "https://wdr-1live-diggi.icecastssl.wdr.de/wdr/1live/diggi/mp3/256/stream.mp3",# geht nicht 

    # SWR (Baden-Württemberg / Rheinland-Pfalz)
    "swr1": "https://liveradio.swr.de/sw282p3/swr1bw/play.mp3", # geht
    "swr3": "https://liveradio.swr.de/sw282p3/swr3/play.mp3", # geht
    "dasding": "https://liveradio.swr.de/sw282p3/dasding/play.mp3", # geht

    # NDR (Norddeutschland)
    "ndr1": "https://icecast.ndr.de/ndr/ndr1niedersachsen/hannover/mp3/128/stream.mp3", # geht
    "ndr2": "https://icecast.ndr.de/ndr/ndr2/niedersachsen/mp3/128/stream.mp3", # geht
    "ndr info": "https://icecast.ndr.de/ndr/ndrinfo/niedersachsen/mp3/128/stream.mp3", # geht
    "n-joy": "https://icecast.ndr.de/ndr/njoy/live/mp3/128/stream.mp3", # geht

    # BR (Bayern)
    "bayern 1": "https://dispatcher.rndfnk.com/br/br1/franken/mp3/mid", # geht
    "bayern 3": "https://dispatcher.rndfnk.com/br/br3/live/mp3/mid", # geht
    "br klassik": "https://dispatcher.rndfnk.com/br/brklassik/live/mp3/mid", # geht
    "puls": "https://dispatcher.rndfnk.com/br/puls/live/mp3/mid",  # geht nicht

    # HR (Hessen)
    "hr1": "https://dispatcher.rndfnk.com/hr/hr1/live/mp3/mid", # geht nicht
    "hr3": "https://dispatcher.rndfnk.com/hr/hr3/live/mp3/mid", # geht nicht
    "you fm": "https://dispatcher.rndfnk.com/hr/youfm/live/mp3/mid", # geht nicht

    # RBB (Berlin / Brandenburg)
    "fritz": "https://dispatcher.rndfnk.com/rbb/fritz/live/mp3/mid",
    "radioeins": "https://dispatcher.rndfnk.com/rbb/radioeins/live/mp3/mid", # geht
    "antenne brandenburg": "https://dispatcher.rndfnk.com/rbb/antennebrandenburg/live/mp3/mid",

    # MDR (Mitteldeutschland)
    "mdr jump": "https://dispatcher.rndfnk.com/mdr/jump/live/mp3/mid", # geht nicht
    "mdr sputnik": "https://dispatcher.rndfnk.com/mdr/sputnik/live/mp3/mid", # geht nicht

    # Privatsender
    "radio bob": "https://streams.radiobob.de/bob-live/mp3-192/mediaplayer",
    "rock antenne": "https://stream.rockantenne.de/rockantenne/stream/mp3",
    "sunshine live": "https://stream.sunshine-live.de/live/mp3-192/stream.mp3",
    "bigfm": "https://streams.bigfm.de/bigfm-deutschland-128-mp3",
    "antenne bayern": "https://stream.antenne.de/antenne/stream/mp3",
    "radio energy": "https://scdn.nrjaudio.fm/adwz2/de/30001/mp3_128.mp3", # geht nicht
    "ffn": "https://player.ffn.de/ffn.mp3",
    "radio hamburg": "https://player.radiohamburg.de/radiohamburg.mp3", # geht nicht
    "kiss fm": "https://streams.kissfm.de/kissfm/mp3-192/internetradio", # geht nicht
    "delta radio": "https://streams.deltaradio.de/deltaradio/mp3-192/mediaplayerstream",
    "radio paloma": "https://pool.radiopaloma.de/RADIOPALOMA.mp3",
    "klassik radio": "https://stream.klassikradio.de/live/mp3-192/stream.mp3",
    "absolut relax": "https://stream.absolutradio.de/absolut-relax/mp3-192/stream.mp3", # geht nicht
    "jam fm": "https://streams.jam.fm/jam-nmr/mp3-192/konsole", # geht nicht
    "harmony fm": "https://dispatcher.rndfnk.com/hr/harmonyfm/live/mp3/mid", # geht nicht

    # Chill / Lounge
    "lounge radio": "https://streams.fluxfm.de/Chillhop/mp3-320/streams.fluxfm.de/",
    "flux fm": "https://streams.fluxfm.de/live/mp3-320/streams.fluxfm.de/",

    # Genre-Streams
    "charts": "https://scdn.nrjaudio.fm/adwz2/de/30009/mp3_128.mp3", # geht nicht
    "top 40": "https://scdn.nrjaudio.fm/adwz2/de/30009/mp3_128.mp3", # geht nicht
    "hits": "https://streams.bigfm.de/bigfm-charts-128-mp3",
    "90er": "https://streams.bigfm.de/bigfm-90s-128-mp3",
    "80er": "https://streams.bigfm.de/bigfm-80s-128-mp3",
    "70er": "https://streams.bigfm.de/bigfm-70s-128-mp3",
    "rock": "https://stream.rockantenne.de/rockantenne/stream/mp3",
    "hip hop": "https://streams.bigfm.de/bigfm-hiphop-128-mp3",
    "electro": "https://stream.sunshine-live.de/live/mp3-192/stream.mp3",
    "schlager": "https://streams.schlagerpiloten.de/schlagerpiloten/mp3-192", # geht nicht
    "jazz": "https://streaming.radio.co/s774887f7b/listen",
    "klassik": "https://stream.klassikradio.de/live/mp3-192/stream.mp3",
    "chill": "https://streams.fluxfm.de/Chillhop/mp3-320/streams.fluxfm.de/",
    "deutsch pop": "https://streams.bigfm.de/bigfm-deutschrap-128-mp3",
}


