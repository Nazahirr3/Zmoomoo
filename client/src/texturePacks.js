// Texture Pack Manager Module
// Adapted from RaZoshi's Texture Pack Manager

const texturePacks = {
    packs: [
        { name: "Default", icon: "https://i.imgur.com/fBgDIOZ.png", desc: "Default Game's Textures" },
        { name: "Old Textures", icon: "https://i.imgur.com/29vGQfg.png", desc: "Murka's Texture Pack" },
        { name: "The Warrior Chronicles", icon: "https://i.imgur.com/MJWtX3o.png", desc: "eXistenZ's Texture Pack" },
        { name: "Red Dragon", icon: "https://i.imgur.com/tMGhbhN.png", desc: "eXistenZ's Texture Pack" },
        { name: "The Black Swordsman", icon: "https://i.imgur.com/7vXJpkE.png", desc: "eXistenZ's Texture Pack" },
        { name: "RSD Pack", icon: "https://i.imgur.com/xkD5fsY.png", desc: "R0YqL & RoTama's Texture Pack" }
    ],
    
    currentPack: "Default",
    loadedImages: new Map(),
    
    // Texture pack data from the original script
    textureData: {}
};

// Initialize texture data (will be populated with actual texture URLs)
texturePacks.init = function() {
    // Store reference to original Image.src descriptor
    const imageDesc = Object.getOwnPropertyDescriptor(Image.prototype, "src");
    
    Object.defineProperty(Image.prototype, "src", {
        get() {
            return imageDesc.get?.call(this);
        },
        set(value) {
            const originalValue = value;
            const paths = {
                "/hats/": {type: "hat", prefix: "hat_"},
                "/accessories/": {type: "acc", prefix: "access_"},
                "/weapons/": {type: "weapons", prefix: "/weapons/"},
                "/animals/": {type: "animals", prefix: "/animals/"},
            };

            let type = "";
            let id = "";

            for (const [path, {type: t, prefix}] of Object.entries(paths)) {
                if (value.includes(path)) {
                    type = t;
                    id = value.split(prefix)[1]?.replace(".png", "") || "";
                    if (type === "hat" && id.includes("_")) {
                        const parts = id.split("_");
                        id = parts[0] + "_" + parts[1];
                    }
                    break;
                }
            }

            if (id && type) {
                const newSrc = texturePacks.getTexturePackImg(id, type);
                if (newSrc) {
                    value = newSrc;
                    texturePacks.loadedImages.set(this, { original: originalValue, type, id });
                }
            }

            return imageDesc.set?.call(this, value);
        },
        configurable: true,
    });
};

texturePacks.getTexturePackImg = function(id, type) {
    if (this.currentPack === "Default") {
        return null; // Use default textures
    }
    
    // Texture pack mappings
    const packData = {
        "Old Textures": {
            hats: {
                7: "https://i.postimg.cc/zGnZNZNG/Bull-Helmet-V2.png",
                58: "https://i.postimg.cc/B67RpJTM/Bushido-Armor.png",
                26: "https://i.postimg.cc/t40Q8RLc/Barbarian-Armor.png",
                12: "https://i.postimg.cc/BQPfhPwD/Booster-V2.png",
                22: "https://i.postimg.cc/5t3hHB6c/Emp-Helmet.png",
                13: "https://i.postimg.cc/BvqyGjNm/Medic-Gear-V2.png",
                11: "https://i.postimg.cc/7PFqrNzX/Spike-V2.png",
                "11_p": "https://i.postimg.cc/7PFqrNzX/Spike-V2.png",
                "11_top": "",
                9: "https://i.postimg.cc/g0N7cGTm/Miner.png",
                4: "https://i.postimg.cc/Tw14pBzm/Ranger-Hat.png",
                18: "https://i.postimg.cc/RhjyrGbt/Explorer-Hat-V2.png",
                40: "https://i.imgur.com/foDF6AI.png",
                6: "https://i.postimg.cc/662BPP8y/Soldier-Helmet.png",
                20: "https://i.postimg.cc/Dmkjp08d/Samurai-Hat.png",
                23: "https://i.postimg.cc/WpHP6wST/Anti-Venom-Gear.png",
                15: "https://i.postimg.cc/pXKRWnYv/Winter-Cap.png",
                8: "https://i.postimg.cc/XJYT9rCr/Bummel-Hat.png"
            },
            accessories: {
                21: "",
                13: ""
            },
            weapons: {
                "samurai_1_g": "",
                "samurai_1_d": "https://i.imgur.com/2iI0aj8.png",
                "samurai_1_r": "https://i.imgur.com/q32l8gQ.png",
                "sword_1_g": "",
                "sword_1_d": "https://i.imgur.com/7NYsXJf.png",
                "sword_1_r": "https://i.imgur.com/swBWjlg.png",
                "spear_1_g": "",
                "spear_1_d": "https://i.imgur.com/veyLcv4.png",
                "spear_1_r": "https://i.imgur.com/QomIDrJ.png",
                "great_axe_1_g": "",
                "great_axe_1_d": "https://i.imgur.com/hfJTh4R.png",
                "great_axe_1_r": "https://i.imgur.com/9oszeGa.png",
                "axe_1_g": "",
                "axe_1_d": "https://i.imgur.com/tE1FOnb.png",
                "axe_1_r": "https://i.imgur.com/9KKLdVE.png",
                "dagger_1_g": "",
                "dagger_1_d": "https://i.imgur.com/2ZUdMQF.png",
                "dagger_1_r": "https://i.imgur.com/Hqp9vxh.png",
                "hammer_1_g": "https://i.imgur.com/X8u4rXd.png",
                "hammer_1_d": "https://i.imgur.com/LHkSv0v.png",
                "hammer_1_r": "https://i.imgur.com/3Me1GWc.png",
                "great_hammer_1_g": "",
                "great_hammer_1_d": "https://i.imgur.com/KmmT14q.png",
                "great_hammer_1_r": "https://i.imgur.com/tmWLmIU.png",
                "bat_1_g": "",
                "bat_1_d": "",
                "bat_1_r": "https://i.imgur.com/zOITPq2.png",
                "stick_1_g": "",
                "stick_1_d": "",
                "stick_1_r": ""
            }
        },
        "The Warrior Chronicles": {
            hats: {
                7: "https://i.imgur.com/8xB1Q3u.png",
                12: "https://i.imgur.com/VSUId2s.png",
                13: "https://i.imgur.com/EwkbsHN.png",
                11: "https://i.imgur.com/0lnD8LH.png",
                "11_p": "https://i.imgur.com/0lnD8LH.png",
                "11_top": "https://i.imgur.com/s7Cxc9y.png",
                9: "https://i.imgur.com/1nY34aL.png",
                18: "https://i.imgur.com/in5H6vw.png",
                40: "https://i.imgur.com/lKGtlDF.png",
                6: "https://i.imgur.com/kD6iYN8.png",
                20: "https://i.imgur.com/rSNEDel.png",
                23: "https://i.imgur.com/B9AcmcN.png",
                15: "https://i.imgur.com/w3AD2BJ.png",
                8: "https://i.imgur.com/kf8yAC2.png"
            },
            accessories: {
                21: "https://i.imgur.com/eikGSfv.png",
                13: "https://i.imgur.com/Qyxy7IB.png"
            },
            weapons: {
                "samurai_1_g": "https://i.imgur.com/XtLvPYc.png",
                "samurai_1_d": "https://i.imgur.com/cHSvjlv.png",
                "sword_1_g": "https://i.imgur.com/HmjnnXn.png",
                "sword_1_d": "https://i.imgur.com/34rr2qm.png",
                "spear_1_g": "https://i.imgur.com/fCjPvei.png",
                "spear_1_d": "https://i.imgur.com/jjNYCTZ.png",
                "spear_1_r": "https://i.imgur.com/QomIDrJ.png",
                "great_axe_1_d": "https://i.imgur.com/vzlwkVK.png",
                "great_axe_1_r": "https://i.imgur.com/9oszeGa.png",
                "axe_1_d": "https://i.imgur.com/enUNTMp.png",
                "axe_1_r": "https://i.imgur.com/9KKLdVE.png",
                "dagger_1_d": "https://i.imgur.com/2ZUdMQF.png",
                "dagger_1_r": "https://i.imgur.com/Hqp9vxh.png",
                "hammer_1_g": "https://i.imgur.com/X8u4rXd.png",
                "hammer_1_d": "https://i.imgur.com/LHkSv0v.png",
                "hammer_1_r": "https://i.imgur.com/3Me1GWc.png",
                "great_hammer_1_d": "https://i.imgur.com/KmmT14q.png",
                "great_hammer_1_r": "https://i.imgur.com/tmWLmIU.png",
                "bat_1_r": "https://i.imgur.com/zOITPq2.png"
            }
        },
        "Red Dragon": {
            hats: {
                7: "https://i.imgur.com/vAOzlyY.png",
                12: "https://i.imgur.com/VSUId2s.png",
                13: "https://i.imgur.com/EwkbsHN.png",
                11: "https://i.imgur.com/yfqME8H.png",
                "11_p": "https://i.imgur.com/yfqME8H.png",
                "11_top": "https://i.imgur.com/s7Cxc9y.png",
                9: "https://i.imgur.com/gJY7sM6.png",
                18: "https://i.imgur.com/in5H6vw.png",
                40: "https://i.imgur.com/pe3Yx3F.png",
                6: "https://i.imgur.com/vM9Ri8g.png",
                20: "https://i.imgur.com/JbUPrtp.png",
                23: "https://i.imgur.com/JPMqgSc.png",
                15: "https://i.imgur.com/YRQ8Ybq.png",
                8: "https://i.imgur.com/uYgDtcZ.png",
                26: "https://i.imgur.com/2PsUgEL.png",
                52: "https://i.imgur.com/hmJrVQz.png"
            },
            accessories: {
                21: "https://i.imgur.com/4ddZert.png",
                18: "https://i.imgur.com/0rmN7L9.png",
                19: "https://i.imgur.com/sULkUZT.png"
            },
            weapons: {
                "samurai_1_g": "https://i.imgur.com/QKBc2ou.png",
                "samurai_1_d": "https://i.imgur.com/4ZxIJQM.png",
                "samurai_1_r": "https://i.imgur.com/vxLZW0S.png",
                "sword_1_g": "https://i.imgur.com/V9dzAbF.png",
                "sword_1_d": "https://i.imgur.com/h5jqSRp.png",
                "sword_1_r": "https://i.imgur.com/V9dzAbF.png",
                "spear_1_g": "https://i.imgur.com/jKDdyvc.png",
                "spear_1_d": "https://i.imgur.com/HSWcyku.png",
                "spear_1_r": "https://i.imgur.com/UY7SV7j.png",
                "great_axe_1_d": "https://i.imgur.com/aAJyHBB.png",
                "great_axe_1_r": "https://i.imgur.com/UZ2HcQw.png",
                "axe_1_d": "https://i.imgur.com/OU5os0h.png",
                "axe_1_r": "https://i.imgur.com/kr8H9g7.png",
                "dagger_1_d": "https://i.imgur.com/ROTb7Ks.png",
                "dagger_1_r": "https://i.imgur.com/CDAmjux.png"
            }
        },
        "The Black Swordsman": {
            hats: {
                7: "https://i.imgur.com/8xB1Q3u.png",
                12: "https://i.imgur.com/VSUId2s.png",
                13: "https://i.imgur.com/EwkbsHN.png",
                11: "https://i.imgur.com/Gu3ZJlY.png",
                "11_p": "https://i.imgur.com/NCkyBlK.png",
                "11_top": "https://i.imgur.com/zWJTlbI.png",
                9: "https://i.imgur.com/1nY34aL.png",
                18: "https://i.imgur.com/in5H6vw.png",
                40: "https://i.imgur.com/lKGtlDF.png",
                6: "https://i.imgur.com/kD6iYN8.png",
                20: "https://i.imgur.com/34ESjYy.png",
                23: "https://i.imgur.com/B9AcmcN.png",
                15: "https://i.imgur.com/YRQ8Ybq.png",
                8: "https://i.imgur.com/WHJch5H.png",
                14: "https://i.imgur.com/V4l7o1h.png",
                "14_p": "https://i.imgur.com/836PpI0.png",
                "14_top": "https://i.imgur.com/zWJTlbI.png",
                31: "https://i.imgur.com/JPMqgSc.png"
            },
            accessories: {
                21: "https://i.imgur.com/tuw16mP.png",
                18: "https://i.imgur.com/sRGXKvJ.png",
                19: "https://i.imgur.com/XWW0RJV.png"
            },
            weapons: {
                "samurai_1_g": "https://i.imgur.com/XtLvPYc.png",
                "samurai_1_d": "https://i.imgur.com/PUTTmVS.png",
                "sword_1_g": "https://i.imgur.com/HmjnnXn.png",
                "sword_1_d": "https://i.imgur.com/nzy3kz1.png",
                "spear_1_g": "https://i.imgur.com/fCjPvei.png",
                "spear_1_d": "https://i.imgur.com/mcI9MTd.png",
                "great_axe_1_d": "https://i.imgur.com/HjgV9p5.png",
                "axe_1_d": "https://i.imgur.com/AbVX635.png",
                "dagger_1_d": "https://i.imgur.com/ROTb7Ks.png",
                "hammer_1_d": "https://i.imgur.com/0XKpSVI.png",
                "great_hammer_1_d": "https://i.imgur.com/CVCwqES.png",
                "bow_1_d": "https://i.imgur.com/Dgv1gZm.png",
                "crossbow_1_d": "https://i.imgur.com/R2awlGz.png",
                "crossbow_2_d": "https://i.imgur.com/7PJOAk0.png",
                "shield_1_g": "https://i.imgur.com/zYP8eVL.png",
                "shield_1_d": "https://i.imgur.com/n571biC.png"
            }
        },
        "RSD Pack": {
            hats: {
                40: "http://i.imgur.com/yp9hwJp.png",
                6: "http://i.imgur.com/L6L0Q0l.png",
                7: "http://i.imgur.com/wqG2CBb.png",
                12: "http://i.imgur.com/eQxzyTD.png",
                1: "http://i.imgur.com/ZeKh57w.png",
                51: "http://i.imgur.com/d1s1LpB.png",
                31: "http://i.imgur.com/eLz8PZC.png",
                50: "http://i.imgur.com/q9JlWrd.png",
                11: "http://i.imgur.com/EbrAqWU.png",
                "11_p": "http://i.imgur.com/EbrAqWU.png",
                15: "http://i.imgur.com/4Ti0G4R.png",
                20: "http://i.imgur.com/BdPQwfF.png",
                22: "http://i.imgur.com/CoeJltc.png",
                53: "http://i.imgur.com/uQvWtke.png",
                "53_p": "http://i.imgur.com/uQvWtke.png"
            },
            accessories: {
                19: "http://i.imgur.com/SWdR4eY.png",
                13: "http://i.imgur.com/zgR1rYf.png",
                18: "http://i.imgur.com/T5oPBsc.png"
            },
            weapons: {
                "samurai_1_g": "https://i.imgur.com/XtLvPYc.png",
                "samurai_1_d": "https://i.imgur.com/cHSvjlv.png",
                "sword_1_g": "https://i.imgur.com/HmjnnXn.png",
                "sword_1_d": "https://i.imgur.com/34rr2qm.png",
                "spear_1_g": "https://i.imgur.com/fCjPvei.png",
                "spear_1_d": "https://i.imgur.com/jjNYCTZ.png",
                "spear_1_r": "https://i.imgur.com/QomIDrJ.png",
                "great_axe_1_d": "https://i.imgur.com/vzlwkVK.png",
                "great_axe_1_r": "https://i.imgur.com/9oszeGa.png",
                "axe_1_d": "https://i.imgur.com/enUNTMp.png",
                "axe_1_r": "https://i.imgur.com/9KKLdVE.png",
                "dagger_1_d": "https://i.imgur.com/2ZUdMQF.png",
                "dagger_1_r": "https://i.imgur.com/Hqp9vxh.png",
                "hammer_1_g": "https://i.imgur.com/X8u4rXd.png",
                "hammer_1_d": "https://i.imgur.com/LHkSv0v.png",
                "hammer_1_r": "https://i.imgur.com/3Me1GWc.png",
                "great_hammer_1_d": "https://i.imgur.com/KmmT14q.png",
                "great_hammer_1_r": "https://i.imgur.com/tmWLmIU.png",
                "bat_1_r": "https://i.imgur.com/zOITPq2.png"
            }
        }
    };
    
    const pack = packData[this.currentPack];
    if (!pack) return null;
    
    // Map type to the correct category
    let category;
    if (type === "hat") category = "hats";
    else if (type === "acc") category = "accessories";
    else if (type === "weapons") category = "weapons";
    else if (type === "animals") category = "animals";
    else return null;
    
    const textureUrl = pack[category]?.[id];
    
    // Return null if texture is empty string or undefined (use default)
    if (!textureUrl || textureUrl === "") return null;
    
    return textureUrl;
};

texturePacks.setPack = function(packName) {
    this.currentPack = packName;
    this.updateAllTextures();
    
    // Save to localStorage
    localStorage.setItem('selectedTexturePack', packName);
};

texturePacks.updateAllTextures = function() {
    this.loadedImages.forEach((info, imgElement) => {
        const newSrc = this.getTexturePackImg(info.id, info.type);
        if (newSrc && newSrc !== "") {
            imgElement.src = newSrc;
        }
    });
};

// Load saved pack preference
texturePacks.loadSavedPack = function() {
    const saved = localStorage.getItem('selectedTexturePack');
    if (saved) {
        this.currentPack = saved;
    }
};

module.exports = texturePacks;
