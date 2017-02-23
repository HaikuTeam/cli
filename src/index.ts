
import * as clc from "cli-color"
import * as path from "path"
import * as inquirer from "inquirer"
import * as _ from "lodash"
import { argv } from "yargs"
import * as request from "request"
import * as chalk from "chalk"
import * as mkdirp from "mkdirp"
import * as fs from "fs"

import { inkstone, client } from "haiku-sdk"

let dedent = require("dedent")

const banner = dedent`
  Haiku CLI (version 0.0.0)

  Usage:
    haiku <command> [flags]

  Commands:
    help - Display this message
`

const args = argv._

const subcommand = args.shift()

const flags = _.clone(argv)
delete flags._
delete flags.$0

function finish(code?: number) {
  process.exit(code)
}

// process.stdin.resume()
function exitwrap(maybeException) {
  if (maybeException) console.log(maybeException)
  process.exit()
}
process.on("exit", exitwrap)
process.on("SIGINT", exitwrap)
process.on("uncaughtException", exitwrap)

const main = path.join(__dirname, "..", "creator", "electron-main.js")

function handleError(err) {
  //TODO: figure out error categories, allow individual CLI commands to handle categories as needed
}

function help() {
  console.log(banner)
  finish()
}

function ensureAuth(cb) {
  var token = client.config.getAuthToken()
  if (!token || token == "") {
    console.log("You must be authenticated to do that.")
    doLogin(function () {
      token = client.config.getAuthToken()
      if (!token || token == "") {
        console.log("Hm, that didn't work.  Let's try again.")
        ensureAuth(cb)
      } else {
        cb(token)
      }
    })
  } else {
    cb(token)
  }
}


inkstone.setConfig({
  baseUrl: flags.api || "https://inkstone.haiku.ai/"
});

if (flags.verbose) {
  client.setConfig({ verbose: true })
  console.log("Flags: ", flags)
}

switch (subcommand) {
  case "clone":
    doClone()
    break
  case "list":
    doList()
    break
  case "login":
    doLogin()
    break
  case "logout":
  case "logoff":
    doLogout()
    break
  case "new":
  case "generate":
  case "create":
    //Not intended for user consumption yet
    doCreate()
    break
  // case "import":
  //   doImport()
  //   break
  case "install":
    doInstall()
    break
  case "open":
    doOpen()
    break
  case "help":
    help()
    break
  default:
    help()
    break
}

function doClone() {
  var projectName = args[0]
  var destination = args[1] || projectName
  if (destination.charAt(destination.length - 1) !== "/") destination += "/"

  ensureAuth(function (token) {
    inkstone.project.getByName(projectName, function (err, projectAndCredentials) {
      if (err) {
        console.log(chalk.bold(`Project ${projectName} not found.`))
      } else {
        var gitEndpoint = projectAndCredentials.Project.GitRemoteUrl
        //TODO:  store credentials more securely than this
        gitEndpoint = gitEndpoint.replace("https://", "https://" + encodeURIComponent(projectAndCredentials.Credentials.CodeCommitHttpsUsername) + ":" + encodeURIComponent(projectAndCredentials.Credentials.CodeCommitHttpsPassword) + "@")

        client.git.cloneRepo(gitEndpoint, destination, (err) => {
          if(err != undefined){
            console.log(chalk.red("Error cloning project.  Use the --verbose flag for more information."))
          }else{
            console.log(`Project ${chalk.bold(projectName)} cloned to ${chalk.bold(destination)}`)
          }
        })
      }
    })
  })
}


function doCreate() {
  ensureAuth((token: string) => {
    //TODO:  support "cloning" project directly into fs after creation (i.e. autoimport)
    inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Project Name:",
      }
    ]).then(function (answers: inquirer.Answers) {
      var projectName = answers["name"]
      console.log("Creating project...")
      inkstone.project.create({ Name: projectName }, (err, project) => {
        if (err) {
          console.log("Error creating project.  Does this project with this name already exist?")
        } else {
          console.log("Project created!")
        }
      })
    })
  })
}

//USAGE:  haiku import design-test dest/
//        clone git repo "someendpoint/design-test" as a subtree into the dest/design-test folder
function doImport() {
  var projectName = args[0]
  var destination = args[1] || projectName
  if (destination.charAt(destination.length - 1) !== "/") destination += "/"

  ensureAuth(function (token) {
    inkstone.project.getByName(projectName, function (err, projectAndCredentials) {
      if (err) {
        console.log(chalk.bold(`Project ${projectName} not found.`))
      } else {

        var actuallyDoImport = function () {
          var gitEndpoint = projectAndCredentials.Project.GitRemoteUrl
          //TODO:  store credentials more securely than this
          gitEndpoint = gitEndpoint.replace("https://", "https://" + encodeURIComponent(projectAndCredentials.Credentials.CodeCommitHttpsUsername) + ":" + encodeURIComponent(projectAndCredentials.Credentials.CodeCommitHttpsPassword) + "@")

          client.git.ensureRemoteIsInitialized(projectName, gitEndpoint, () => {
            client.git.forciblyCloneSubrepo(projectName, destination, () => {
              console.log(`Project ${chalk.bold(projectName)} imported to ${chalk.bold(destination)}`)
            })
          })
        }

        //check if directory exists and is non-empty
        //if it does, prompt user that it exists & has stuff in it
        //ask whether it should be overwritten
        var alreadyExists = fs.existsSync(path.resolve(destination))
        if (alreadyExists) {
          inquirer.prompt([
            {
              type: "confirm",
              name: "confirmed",
              message: `The destination directory ${destination} already exists.  Do you want to overwrite it?`,
            }
          ]).then(function (answers: inquirer.Answers) {
            if (answers["confirmed"]) {
              actuallyDoImport()
            }
          })
        } else {
          actuallyDoImport()
        }

      }

    })
  })
}


function doInstall() {
  ensureAuth(function (token) {
    //
  })
}

function doList() {
  ensureAuth((token: string) => {

    if(flags && flags.organizations) {
      inkstone.organization.list((err, organizations) => {
        if (organizations == undefined || organizations.length == 0) {
          console.log("You are not a member of any organizations.")
        } else {
          console.log(chalk.cyan("Your Organizations:"))
          _.forEach(organizations, (org) => {
            console.log("  " + org.Name)
          })
        }
      })
    }else{

      inkstone.project.list((err, projects) => {
        if (projects == undefined || projects.length == 0) {
          console.log("No existing projects.  Use " + chalk.bold("haiku generate") + " to make a new one!")
        } else {
          console.log(chalk.cyan("Your team's Haiku projects:"))
          console.log("(To work with one, call " + chalk.bold("haiku clone project_name") + " or " + chalk.bold("haiku install project_name"))
          _.forEach(projects, (project) => {
            console.log("  " + project.Name)
          })
        }
      })
    }
  })
}

function doLogin(cb?: Function) {
  console.log("Enter your Haiku credentials.")
  var username = ""
  var password = ""

  inquirer.prompt([
    {
      type: "input",
      name: "username",
      message: "Email:",
    },
    {
      type: "password",
      name: "password",
      message: "Password:",
    }
  ]).then(function (answers: inquirer.Answers) {
    username = answers["username"]
    password = answers["password"]

    inkstone.user.authenticate(username, password, function (err, authResponse) {
      if (err != undefined) {
        console.log(chalk.bold.red("Username or password incorrect."))
        if (flags.verbose) {
          console.log(err)
        }
      } else {
        console.log(chalk.bold.green(`Welcome ${username}!`))
      }
      if (cb) {
        cb()
      }
    })
  })
}

function doLogout() {
  client.config.setAuthToken("")
}

function doOpen() {
  var projectName = args[0]

  ensureAuth(function (token) {
    inkstone.project.getByName(projectName, function (err, project) {
      console.log("TODO:  launch an instance of Haiku with this project open:", project)
    })
  })
}






