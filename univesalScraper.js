var DomParser = require('dom-parser');
var request = require('request');
var sync = require('sync-request');
var tr = require('tor-request');
var fs = require('fs');
var MongoClient = require('mongodb').MongoClient;
var WAValidator = require('wallet-address-validator'); //bitcoin address validator

//on recupere les parametre
opt = require('node-getopt').create([
	['u' , '=' , 'scrap for a clearweb or a darknet website the parameter is the url (it can be a .onion)' ],
	['d' , '=' , 'scrap websites for a specified google dork the parameter is the google dork' ],
        ['n' , '=' , 'work with the -d option, set the number of search results for a google dork (max is 100)' ],
        ['s' , '=' , 'work with the -d option, set the starting result for a google dork'  ],
	['h' , 'help' , 'display this help']
])
.bindHelp()
.parseSystem();

var siteArray = new Array();

// gestion d'erreur
if (opt['options']['d'] == null && opt['options']['d'] == undefined
   && opt['options']['u'] == null && opt['options']['u'] == undefined) {
	console.log("\n you need to specify -h or -u option \n");
	process.exit();
}

if (opt['options']['u'] !== null && opt['options']['u'] !== undefined) {
	if (opt['options']['s'] !== null && opt['options']['s'] !== undefined) {
		console.log("\n -s option work with the -d option \n");
		process.exit();
	}
	if (opt['options']['n'] !== null && opt['options']['n'] !== undefined) {
                console.log("\n -n option work with the -d option \n");
		process.exit();
	}
	siteArray.push(opt['options']['u']);
}

// on recupere tous les sites pour un dork
if (opt['options']['d'] !== null && opt['options']['d'] !== undefined) {
	var num = 10;
	var start = 0;
	if (opt['options']['n'] !== null && opt['options']['n'] !== undefined) {
		num = opt['options']['n'];
	}
        if (opt['options']['s'] !== null && opt['options']['s'] !== undefined) {
                start = opt['options']['s'];
        }
	console.log("Get "+num+" link starting at result "+start+" for the google dork \033[36m"+opt['options']['d']+" \033[0m\n");
	var google = "https://www.google.fr/search?q="+opt['options']['d']+"&num="+num+"&start="+start;
	var res = sync('GET',google);
        var body = res.getBody('utf8');
	var parser = new DomParser();
        var dom = parser.parseFromString(body);
	var elements = dom.getElementsByTagName('cite');
	elements.forEach(function(element) {
  		siteArray.push(element.textContent);
	});
}

var content;
console.log(siteArray);
console.log("\n");

// on recupere et on traite le texte
siteArray.forEach(function(site) {
	site = defaultProtocol(site);
	httpError = false;
	console.log("Scraping for \033[36m"+site+"\033[0m");
	var tmp = site.split(".");
	if (tmp[1] == "onion")
	{
		tr.request(site, function (err, res, body) {
        		if (!err && res.statusCode == 200) {
        			content = parseText(body);
				saveFile(site,content);
				//saveDB(content, "content/"+site, site)
				console.log("\033[32m Success \033[0m");
                	}
			else {
				console.log("\033[31m Fail \033[0m");
			}
        	});
	} else {
		try {
        		var res = sync('GET',site);
			var content = parseText(res.getBody('utf8'));
                	saveFile(site,content);
			//saveDB(content, "content/"+site, site)
		} catch (e) {
			console.log("\033[31m Fail \033[0m Server responded with status code "+e.statusCode);
			httpError = 1;
		}
		if (!httpError) {
        		console.log("\033[32m Success \033[0m");
		}
	}
});

console.log("\n\033[33mall data saved in the content folder\033[0m\n");

// recupere seulement le texte a partir du code source d'une page
function parseText(content) {
	var test2 = content.replace(/<script([\s\S]*?)<\/script>/gi,"");
	var test2 = test2.replace(/<style([\s\S]*?)<\/style>/gi,"");
        var parser = new DomParser();
        var dom = parser.parseFromString(test2);
        var test = dom.getElementsByTagName("html")[0].textContent.replace(/<!--([\s\S]*?)-->/g,"");
	return test;
}

//save dans une base de donnée Mongo
function saveDB (str, filepath, url) {
	//email
	let re1 = str.match(/(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/g);
	//phone
	let re2 = str.match(/(\+33|0|0033)[0-9]{9}/g);
	//wallet
	let re3 = str.match(/[13][a-km-zA-HJ-NP-Z1-9]{25,34}/g);
 	//keyword
	var content = fs.readFileSync("keywords.txt",'utf8');
	let tab = content.split("\n");
	//let keyword
	MongoClient.connect("mongodb://localhost/threathunter", function(error, db) {
        	let collection = db.collection('data')
    		if (error) throw error;
                if (re1 !== null) {
                        re1.forEach((email) => {
                                collection.insert({type: 'email', value: email, filepath: filepath, url: url});
                        });
                }
                if (re2 !== null) {
                        re2.forEach((phone) => {
                                collection.insert({type: 'phone', value: phone, filepath: filepath, url: url});
                        });
                }
                if (re3 !== null) {
                        re3.forEach((wallet) => {
				var valid = WAValidator.validate(wallet, 'BTC'); // verifie si l'address est valide
				if (valid) {
                                	collection.insert({type: 'wallet', value: wallet, filepath: filepath, url: url});
				}
                        });
                }
                if (tab !== null) {
                        tab.forEach((keyword) => {
                                const reg = new RegExp(keyword, "i");
                                if (str.search(reg) != -1 && keyword != "") {
                                        collection.insert({type: 'keyword', value: keyword, filepath: filepath, url: url});
                                }
                        });
                }
		db.close();
	});
}

// save dans un fichier
function saveFile(name, text) {
	tmp = name.split("/");
	name = "content/"+tmp[2];
	fs.writeFile(name, text, function(err) {
    		if(err) {
        		return console.log(err);
    		}
	});
}

// si le protocole n'est pas specifié utilise le http
function defaultProtocol(site) {
        const reg = new RegExp(/^http:\/\/|^https:\/\//, "g");
	if (site.search(reg) == -1) {
		return "http://"+site;
	} else {
		return site;
	}
}
