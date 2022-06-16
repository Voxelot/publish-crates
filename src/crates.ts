import {HttpClient, HttpCodes} from '@actions/http-client'
import {delay} from './utils'

interface CrateInfo {
    crate: {
        id: string
        name: string
        created_at: string
        updated_at: string
    }
    versions: VersionInfo[]
}

interface VersionInfo {
    crate: string
    crate_size: number
    num: string
    created_at: string
    updated_at: string
    dl_path: string
}

const client = new HttpClient('publish-crates')

async function getCrateInfo(
    crate: string,
    registry: string
): Promise<CrateInfo | undefined> {
    const url = `${registry}/api/v1/crates/${crate}`
    const res = await client.get(url)
    if (res.message.statusCode === HttpCodes.NotFound) {
        return
    }
    if (res.message.statusCode !== HttpCodes.OK) {
        const raw = await res.readBody()
        throw new Error(
            `Error when requesting crate '${crate}' info from ${registry} (status: ${res.message.statusCode}, contents: '${raw}')`
        )
    }
    const raw = await res.readBody()
    try {
        return JSON.parse(raw)
    } catch (error) {
        throw new Error(`Error when parsing response JSON: ${error}`)
    }
}

export interface Version {
    version: string
    created: Date
    dl_path: string
}

export async function getCrateVersions(
    crate: string,
    registry: string
): Promise<Version[] | undefined> {
    const data = await getCrateInfo(crate, registry)
    if (!data) {
        return
    }
    return data.versions.map(
        ({num, created_at, dl_path}) =>
            ({
                version: num,
                created: new Date(created_at),
                dl_path
            } as Version)
    )
}

export async function checkCrateAvailability(
    registry: string,
    dl_path: string
): Promise<boolean> {
    const url = `${registry}${dl_path}`
    const res = await client.head(url)
    return res.message.statusCode === HttpCodes.OK
}

export async function awaitCrateVersion(
    crate: string,
    version: string,
    registry: string,
    timeout = 60000
): Promise<void> {
    const started = Date.now()
    let dl_path: string
    for (;;) {
        await delay(5000)
        const versions = await getCrateVersions(crate, registry)
        if (
            versions &&
            versions.some(version_info => version_info.version === version)
        ) {
            dl_path = versions.filter(
                version_info => version_info.version === version
            )[0].dl_path
            break
        }
        if (Date.now() - started > timeout) {
            throw new Error(
                `Timeout '${timeout}ms' reached when awaiting crate '${crate}' version '${version}' to be published`
            )
        }
    }
    for (;;) {
        if (await checkCrateAvailability(registry, dl_path)) {
            break
        }
        if (Date.now() - started > timeout) {
            throw new Error(
                `Timeout '${timeout}ms' reached when awaiting crate '${crate}' version '${version}' to be downloadable`
            )
        }
        await delay(1000)
    }
}
