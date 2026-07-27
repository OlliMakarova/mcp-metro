var subwayOptions = {
entranceMin: 170,
entranceMax: 230,
transferMin: 150,
transferMax: 240,
trainLatency: 80,
trainSpeed: [0.15, 0.3, 0.35, 0.4, 0.45, 0.47, 0.48, 0.49, 0.5],
stageFault: 2,
stopTime: 20
};

var subwayData = {
lines: {
kiv: [{id:"prv",x:168,y:932},{id:"lpr",x:168,y:888},{id:"avt",x:169,y:854},{id:"kiz",x:170,y:820},{id:"nar",x:209,y:788},{id:"bal",x:293,y:750},{id:"tin",x:429,y:688},{id:"psh",x:508,y:652},{id:"vld",x:614,y:563},{id:"plv",x:614,y:490},{id:"chr",x:614,y:436},{id:"pll",x:614,y:377},{id:"vyb",x:614,y:331},{id:"les",x:614,y:283},{id:"plm",x:614,y:199},{id:"pol",x:614,y:160},{id:"akd",x:614,y:123},{id:"grp",x:614,y:76},{id:"dev",x:614,y:27}]
,
mop: [{id:"par",x:430,y:26},{id:"prp",x:430,y:65},{id:"ozr",x:430,y:106},{id:"udl",x:430,y:151},{id:"pnr",x:430,y:192},{id:"chr",x:430,y:234},{id:"pet",x:430,y:335},{id:"gor",x:430,y:404},{id:"npr",x:430,y:490},{id:"spl",x:432,y:564},{id:"tin",x:430,y:688},{id:"frn",x:430,y:754},{id:"mov",x:430,y:795},{id:"els",x:430,y:833},{id:"pap",x:430,y:878},{id:"mos",x:430,y:920},{id:"zvz",x:430,y:949},{id:"kup",x:430,y:979}]
,
nev: [{id:"beg",x:110,y:234},{id:"nvk",x:110,y:306},{id:"prm",x:110,y:410},{id:"vas",x:295,y:490},{id:"gdv",x:430,y:490},{id:"mkv",x:614,y:490},{id:"pan",x:770,y:563},{id:"elz",x:770,y:840},{id:"lom",x:770,y:897},{id:"prl",x:770,y:952},{id:"obh",x:770,y:1007},{id:"ryb",x:770,y:1065}]
,
prb: [{id:"gor",x:275,y:527},{id:"sps",x:432,y:564},{id:"dst",x:614,y:563},{id:"lpr",x:693,y:563},{id:"pan",x:770,y:563},{id:"nch",x:882,y:624},{id:"lad",x:882,y:686},{id:"prb",x:882,y:774},{id:"uld",x:882,y:842}]
,
frp: [{id:"kpr",x:240,y:132},{id:"std",x:240,y:195},{id:"kos",x:240,y:313},{id:"chk",x:270,y:374},{id:"spr",x:305,y:414},{id:"adm",x:389,y:512},{id:"sad",x:432,y:564},{id:"zvn",x:508,y:652},{id:"obk",x:568,y:720},{id:"vlk",x:606,y:765},{id:"buh",x:628,y:841},{id:"mez",x:628,y:897},{id:"prs",x:628,y:952},{id:"dun",x:628,y:1007},{id:"shu",x:628,y:1065}]
,
kra: [{id:"yuz",x:100,y:851},{id:"put",x:170,y:820}]
},
close: [],
open: [],
transfers: [{s1:"kiv-kiz",s2:"kra-put"},{s1:"kiv-tin",s2:"mop-tin"},{s1:"kiv-psh",s2:"frp-zvn"},{s1:"kiv-vld",s2:"prb-dst"},{s1:"kiv-plv",s2:"nev-mkv"},{s1:"mop-npr",s2:"nev-gdv"},{s1:"mop-spl",s2:"prb-sps"},{s1:"mop-spl",s2:"frp-sad"},{s1:"mop-tin",s2:"kiv-tin"},{s1:"nev-gdv",s2:"mop-npr"},{s1:"nev-mkv",s2:"kiv-plv"},{s1:"nev-pan",s2:"prb-pan"},{s1:"prb-sps",s2:"mop-spl"},{s1:"prb-sps",s2:"frp-sad"},{s1:"prb-dst",s2:"kiv-vld"},{s1:"prb-pan",s2:"nev-pan"},{s1:"frp-sad",s2:"mop-spl"},{s1:"frp-sad",s2:"prb-sps"},{s1:"frp-zvn",s2:"kiv-psh"},{s1:"kra-put",s2:"kiv-kiz"}]
};